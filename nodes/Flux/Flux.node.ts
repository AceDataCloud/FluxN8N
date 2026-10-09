import { NodeConnectionTypes, NodeOperationError, OperationalError, UserError } from 'n8n-workflow';
import type { IDataObject, IExecuteFunctions, INodeExecutionData, INodeProperties, INodeType, INodeTypeDescription } from 'n8n-workflow';

const ratioSizes = ['1:1', '16:9', '21:9', '3:2', '2:3', '4:3', '3:4', '9:16', '9:21'];
const pixelSizes = ['1024x1024', '1024x1792', '1792x1024'];
const generationModels = ['flux-dev', 'flux-pro', 'flux-2-flex', 'flux-2-pro', 'flux-2-max'];
const editingModels = ['flux-kontext-pro', 'flux-kontext-max'];

const properties: INodeProperties[] = [
  {
    displayName: 'Resource', name: 'resource', type: 'options', default: 'image', noDataExpression: true,
    options: [{ name: 'Image', value: 'image' }, { name: 'Task', value: 'task' }],
  },
  {
    displayName: 'Operation', name: 'operation', type: 'options', default: 'generate', noDataExpression: true,
    displayOptions: { show: { resource: ['image'] } },
    options: [
      { name: 'Edit', value: 'edit', action: 'Edit an image', description: 'Edit an image from a public URL' },
      { name: 'Generate', value: 'generate', action: 'Generate an image', description: 'Create an image from a text prompt' },
    ],
  },
  {
    displayName: 'Operation', name: 'operation', type: 'options', default: 'get', noDataExpression: true,
    displayOptions: { show: { resource: ['task'] } },
    options: [
      { name: 'Get', value: 'get', action: 'Get a task', description: 'Retrieve one existing task' },
      { name: 'Get Many', value: 'getMany', action: 'Get many tasks', description: 'Retrieve up to 50 specific task IDs' },
    ],
  },
  {
    displayName: 'Prompt', name: 'prompt', type: 'string', default: '', required: true,
    typeOptions: { rows: 4 }, displayOptions: { show: { resource: ['image'] } },
    description: 'Describe the image to create or the change to make',
  },
  {
    displayName: 'Model', name: 'model', type: 'options', default: 'flux-dev',
    displayOptions: { show: { resource: ['image'], operation: ['generate'] } },
    options: [
      { name: 'Flux 2 Flex', value: 'flux-2-flex' },
      { name: 'Flux 2 Max', value: 'flux-2-max' },
      { name: 'Flux 2 Pro', value: 'flux-2-pro' },
      { name: 'Flux Dev', value: 'flux-dev' },
      { name: 'Flux Pro', value: 'flux-pro' },
    ],
    description: 'Flux model used to generate the image; model choice changes price and size rules',
  },
  {
    displayName: 'Model', name: 'model', type: 'options', default: 'flux-kontext-pro',
    displayOptions: { show: { resource: ['image'], operation: ['edit'] } },
    options: [
      { name: 'Flux Kontext Max', value: 'flux-kontext-max' },
      { name: 'Flux Kontext Pro', value: 'flux-kontext-pro' },
    ],
    description: 'Flux Kontext model used to edit the image',
  },
  {
    displayName: 'Size', name: 'size', type: 'string', default: '1024x1024', required: true,
    displayOptions: { show: { resource: ['image'], operation: ['generate'] } },
    description: 'Flux Dev/Pro: 1024x1024 or an aspect ratio; Flux 2: an aspect ratio such as 1:1',
  },
  {
    displayName: 'Size', name: 'size', type: 'string', default: '1:1', required: true,
    displayOptions: { show: { resource: ['image'], operation: ['edit'] } },
    description: 'Image aspect ratio, for example 1:1 or 16:9',
  },
  {
    displayName: 'Image URL', name: 'imageUrl', type: 'string', default: '', required: true,
    displayOptions: { show: { resource: ['image'], operation: ['edit'] } },
    description: 'A publicly accessible HTTP or HTTPS reference image URL',
  },
  {
    displayName: 'Task ID', name: 'taskId', type: 'string', default: '', required: true,
    displayOptions: { show: { resource: ['task'], operation: ['get'] } },
    description: 'The task ID returned by Generate or Edit',
  },
  {
    displayName: 'Task IDs', name: 'taskIds', type: 'string', default: '', required: true,
    displayOptions: { show: { resource: ['task'], operation: ['getMany'] } },
    description: 'One to 50 comma-separated task IDs',
  },
];

function object(value: unknown): IDataObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as IDataObject : {};
}

function requiredText(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new UserError(`${label} is required`);
  return value.trim();
}

function imageUrl(value: unknown): string {
  const text = requiredText(value, 'Image URL');
  if (!URL.canParse(text)) throw new UserError('Image URL must be an HTTP or HTTPS URL');
  const url = new URL(text);
  if (!['https:', 'http:'].includes(url.protocol) || !url.hostname || url.username || url.password)
    throw new UserError('Image URL must be an HTTP or HTTPS URL without credentials');
  return text;
}

function sizeFor(model: string, operation: string, value: unknown): string {
  const size = requiredText(value, 'Size');
  const valid = operation === 'edit' || model.startsWith('flux-2-')
    ? ratioSizes.includes(size)
    : ratioSizes.includes(size) || pixelSizes.includes(size);
  if (!valid) throw new UserError('Select a supported size for the selected Flux model');
  return size;
}

function taskIds(value: unknown): string[] {
  const ids = requiredText(value, 'Task IDs').split(/[,\n]/).map(v => v.trim()).filter(Boolean);
  if (!ids.length || ids.length > 50) throw new UserError('Provide 1 to 50 task IDs');
  return ids;
}

export function imageBody(get: (name: string) => unknown, operation: string): IDataObject {
  if (operation !== 'generate' && operation !== 'edit') throw new UserError('Select a supported image operation');
  const model = requiredText(get('model'), 'Model');
  if (!(operation === 'generate' ? generationModels : editingModels).includes(model))
    throw new UserError('Select a supported model for this operation');
  const body: IDataObject = {
    action: operation, model, prompt: requiredText(get('prompt'), 'Prompt'),
    size: sizeFor(model, operation, get('size')), async: true,
  };
  if (operation === 'generate') body.count = 1;
  else body.image_url = imageUrl(get('imageUrl'));
  return body;
}

function imageUrls(value: unknown): string[] {
  const found: string[] = [];
  function walk(node: unknown): void {
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (!node || typeof node !== 'object') return;
    for (const [key, item] of Object.entries(node)) {
      if (key === 'image_url' && typeof item === 'string' && /^https?:\/\//.test(item)) found.push(item);
      else if (typeof item === 'object') walk(item);
    }
  }
  walk(value);
  return [...new Set(found)];
}

export function taskResult(record: IDataObject): IDataObject {
  const response = object(record.response);
  const state = String(record.state ?? record.status ?? '').toLowerCase();
  const data = response.data ?? record.data ?? null;
  const error = response.error ?? record.error ?? null;
  const failed = response.success === false || record.success === false || Boolean(error)
    || ['failed', 'error', 'cancelled', 'canceled'].includes(state);
  const complete = !failed && (['succeeded', 'success', 'completed', 'complete'].includes(state)
    || (response.success === true && data !== null) || (Boolean(record.finished_at) && data !== null));
  return {
    taskId: record.id ?? record.task_id ?? '',
    status: failed ? 'failed' : complete ? 'succeeded' : 'processing',
    finished: failed || complete,
    successful: failed ? false : complete ? true : null,
    imageUrls: complete ? imageUrls(data) : [],
    data: complete ? data : null,
    error: failed ? { code: object(error).code ?? 'task_failed', message: 'The task failed; use the task or trace ID to inspect it.' } : null,
    traceId: record.trace_id ?? response.trace_id ?? null,
    cost: response.cost ?? null,
  };
}

function requestFailure(error: unknown): OperationalError {
  const value = error && typeof error === 'object' ? error as {
    httpCode?: unknown; statusCode?: unknown; response?: { statusCode?: unknown; status?: unknown };
  } : {};
  const code = String(value.httpCode ?? value.statusCode ?? value.response?.statusCode ?? value.response?.status ?? '');
  const status = /^\d{3}$/.test(code) ? code : '';
  return new OperationalError(status
    ? `AceDataCloud returned HTTP ${status}. Check the task or request history before retrying.`
    : 'AceDataCloud request did not complete. Check task or request history before retrying; creation may already have been charged.');
}

async function request(context: IExecuteFunctions, endpoint: string, body: IDataObject): Promise<IDataObject> {
  let result: unknown;
  try {
    result = await context.helpers.httpRequestWithAuthentication.call(context, 'aceDataFluxApi', {
      method: 'POST', url: `https://api.acedata.cloud${endpoint}`, body,
      json: true, disableFollowRedirect: true, timeout: 60000,
    });
  } catch (error) { throw requestFailure(error); }
  if (!result || typeof result !== 'object' || Array.isArray(result))
    throw new OperationalError('The service returned an unexpected response');
  const value = object(result);
  if (value.success === false || value.error)
    throw new OperationalError('The service rejected the request. Inspect its task or trace ID.');
  return value;
}

export class Flux implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Flux by AceDataCloud', name: 'flux',
    icon: { light: 'file:icon.svg', dark: 'file:icon.dark.svg' },
    group: ['transform'], version: 1,
    subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
    description: 'Generate or edit Flux images and query the same task until it finishes',
    defaults: { name: 'Flux by AceDataCloud' },
    inputs: [NodeConnectionTypes.Main], outputs: [NodeConnectionTypes.Main],
    usableAsTool: true, credentials: [{ name: 'aceDataFluxApi', required: true }], properties,
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const output: INodeExecutionData[] = [];
    for (let index = 0; index < this.getInputData().length; index++) {
      try {
        try {
          const credentials = await this.getCredentials('aceDataFluxApi');
          if (typeof credentials.apiToken !== 'string' || !credentials.apiToken.trim())
            throw new UserError('Missing API token');
        } catch { throw new NodeOperationError(this.getNode(), 'A Flux by AceDataCloud credential is required.'); }

        const resource = this.getNodeParameter('resource', index) as string;
        const operation = this.getNodeParameter('operation', index) as string;
        if (resource === 'task') {
          const body: IDataObject = operation === 'get'
            ? { action: 'retrieve', id: requiredText(this.getNodeParameter('taskId', index), 'Task ID') }
            : operation === 'getMany'
              ? { action: 'retrieve_batch', ids: taskIds(this.getNodeParameter('taskIds', index)) }
              : {};
          if (!body.action) throw new NodeOperationError(this.getNode(), 'Select a supported task operation');
          const result = await request(this, '/flux/tasks', body);
          const records = operation === 'getMany' ? result.items : [result];
          if (!Array.isArray(records)) throw new NodeOperationError(this.getNode(), 'The service returned an unexpected task list');
          for (const item of records) {
            const record = object(item);
            if (!record.id && !record.task_id) throw new NodeOperationError(this.getNode(), 'The task was not found');
            output.push({ json: taskResult(record), pairedItem: { item: index } });
          }
          continue;
        }
        if (resource !== 'image') throw new NodeOperationError(this.getNode(), 'Select a supported resource');
        const body = imageBody(name => this.getNodeParameter(name, index), operation);
        const result = await request(this, '/flux/images', body);
        if (typeof result.task_id !== 'string' || !result.task_id)
          throw new NodeOperationError(this.getNode(), 'The service did not return a task ID');
        output.push({
          json: { taskId: result.task_id, status: 'submitted', finished: false, successful: null, traceId: result.trace_id ?? null },
          pairedItem: { item: index },
        });
      } catch (error) {
        if (!this.continueOnFail())
          throw new NodeOperationError(this.getNode(), error as Error, { itemIndex: index });
        output.push({ json: { error: (error as Error).message }, pairedItem: { item: index } });
      }
    }
    return [output];
  }
}
