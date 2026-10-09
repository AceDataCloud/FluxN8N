const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Flux, imageBody, taskResult } = require('../dist/nodes/Flux/Flux.node.js');
const { AceDataFluxApi } = require('../dist/credentials/AceDataFluxApi.credentials.js');

const generate = { resource: 'image', operation: 'generate', prompt: 'A teal ceramic cube on cream', model: 'flux-dev', size: '1024x1024' };
function context(parameters, responses = [], { continueOnFail = false, credentials = true } = {}) {
  const calls = [];
  let next = 0;
  return {
    calls,
    getInputData: () => parameters.map(() => ({ json: {} })),
    getNode: () => ({ name: 'Flux', type: '@acedatacloud/n8n-nodes-flux.flux', typeVersion: 1, position: [0, 0], parameters: {} }),
    getNodeParameter: (name, index) => parameters[index][name],
    getCredentials: async () => credentials ? { apiToken: 'test-token' } : Promise.reject(new Error('missing')),
    continueOnFail: () => continueOnFail,
    helpers: {
      httpRequestWithAuthentication: async (credential, request) => {
        calls.push({ credential, ...request });
        const response = responses[next++];
        if (response instanceof Error) throw response;
        return response;
      },
    },
  };
}

const node = new Flux();
test('generation sends one asynchronous request with the selected model and keeps input pairing', async () => {
  const ctx = context([generate], [{ task_id: 'task-1', trace_id: 'trace-1' }]);
  const [items] = await node.execute.call(ctx);
  assert.equal(ctx.calls.length, 1);
  assert.equal(ctx.calls[0].credential, 'aceDataFluxApi');
  assert.equal(ctx.calls[0].url, 'https://api.acedata.cloud/flux/images');
  assert.equal(ctx.calls[0].disableFollowRedirect, true);
  assert.deepEqual(ctx.calls[0].body, { action: 'generate', model: 'flux-dev', prompt: generate.prompt, size: '1024x1024', async: true, count: 1 });
  assert.deepEqual(items[0], { json: { taskId: 'task-1', status: 'submitted', finished: false, successful: null, traceId: 'trace-1' }, pairedItem: { item: 0 } });
});

test('model-specific size rules stop invalid paid requests', async () => {
  const valid = imageBody(name => ({ ...generate, model: 'flux-2-pro', size: '1:1' })[name], 'generate');
  assert.equal(valid.model, 'flux-2-pro');
  assert.equal(valid.size, '1:1');
  for (const bad of [
    { model: 'flux-2-pro', size: '1024x1024' },
    { model: 'flux-dev', size: '1400x900' },
    { model: 'other-model' },
    { prompt: '   ' },
  ]) {
    const ctx = context([{ ...generate, ...bad }]);
    await assert.rejects(node.execute.call(ctx));
    assert.equal(ctx.calls.length, 0);
  }
});

test('editing requires a public reference URL and omits generation count', async () => {
  const edit = { ...generate, operation: 'edit', model: 'flux-kontext-pro', size: '1:1', imageUrl: 'https://example.com/reference.png' };
  const ctx = context([edit], [{ task_id: 'edit-1' }]);
  await node.execute.call(ctx);
  assert.deepEqual(ctx.calls[0].body, { action: 'edit', model: 'flux-kontext-pro', prompt: edit.prompt, size: '1:1', async: true, image_url: edit.imageUrl });
  for (const url of ['', 'file:///tmp/a.png', 'https://user:pass@example.com/a.png']) {
    const bad = context([{ ...edit, imageUrl: url }]);
    await assert.rejects(node.execute.call(bad));
    assert.equal(bad.calls.length, 0);
  }
});

test('task query separates processing, success with image URL, and sanitized failure', () => {
  assert.equal(taskResult({ id: 'a' }).status, 'processing');
  const success = taskResult({ id: 'a', finished_at: 1, response: { success: true, data: [{ image_url: 'https://cdn.acedata.cloud/a.png' }], cost: { amount: 0.2, currency: 'credit' } } });
  assert.equal(success.status, 'succeeded');
  assert.deepEqual(success.imageUrls, ['https://cdn.acedata.cloud/a.png']);
  assert.equal(success.cost.amount, 0.2);
  const failure = taskResult({ id: 'b', state: 'failed', response: { error: { code: 'rejected', message: 'internal supplier detail' } } });
  assert.equal(failure.successful, false);
  assert.equal(failure.error.code, 'rejected');
  assert.doesNotMatch(JSON.stringify(failure), /internal supplier detail/);
});

test('batch retrieval emits one item per task with the original input link', async () => {
  const ctx = context([{ resource: 'task', operation: 'getMany', taskIds: 'a, b' }], [{ items: [{ id: 'a' }, { id: 'b', response: { success: true, data: [{ image_url: 'https://cdn.acedata.cloud/b.png' }] } }] }]);
  const [items] = await node.execute.call(ctx);
  assert.deepEqual(ctx.calls[0].body, { action: 'retrieve_batch', ids: ['a', 'b'] });
  assert.equal(items.length, 2);
  assert.deepEqual(items[1].pairedItem, { item: 0 });
});

test('missing credentials, missing task IDs and malformed responses fail before or at the correct boundary', async () => {
  const missing = context([generate], [], { credentials: false });
  await assert.rejects(node.execute.call(missing), /credential is required/i);
  assert.equal(missing.calls.length, 0);
  const emptyId = context([{ resource: 'task', operation: 'get', taskId: '' }]);
  await assert.rejects(node.execute.call(emptyId));
  assert.equal(emptyId.calls.length, 0);
  await assert.rejects(node.execute.call(context([generate], [{ success: true }])), /task ID/i);
});

test('an uncertain transport failure is not retried automatically', async () => {
  const ctx = context([generate, generate], [new Error('connection lost'), { task_id: 'second' }], { continueOnFail: true });
  const [items] = await node.execute.call(ctx);
  assert.equal(ctx.calls.length, 2);
  assert.match(items[0].json.error, /request history/i);
  assert.equal(items[1].json.taskId, 'second');
});

test('HTTP errors keep their status without exposing upstream error text or retrying', async () => {
  const upstream = Object.assign(new Error('private upstream host and secret'), { response: { statusCode: 429 } });
  const ctx = context([generate], [upstream], { continueOnFail: true });
  const [items] = await node.execute.call(ctx);
  assert.equal(ctx.calls.length, 1);
  assert.match(items[0].json.error, /HTTP 429/);
  assert.doesNotMatch(items[0].json.error, /upstream|secret/);
});

test('credential is masked and its test is query-only', () => {
  const credential = new AceDataFluxApi();
  assert.equal(credential.properties[0].typeOptions.password, true);
  assert.match(credential.authenticate.properties.headers.Authorization, /Bearer/);
  assert.equal(credential.test.request.url, '/flux/tasks');
  assert.deepEqual(credential.test.request.body, { action: 'retrieve_batch', ids: [] });
});
