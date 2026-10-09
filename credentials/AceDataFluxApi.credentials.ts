import type { IAuthenticateGeneric, ICredentialTestRequest, ICredentialType, INodeProperties } from 'n8n-workflow';

export class AceDataFluxApi implements ICredentialType {
  name = 'aceDataFluxApi';
  displayName = 'Flux by AceDataCloud API';
  documentationUrl = 'https://github.com/AceDataCloud/FluxN8N#credentials';
  icon = 'file:../nodes/Flux/icon.svg' as const;
  properties: INodeProperties[] = [
    {
      displayName: 'API Token', name: 'apiToken', type: 'string',
      typeOptions: { password: true }, default: '', required: true,
      description: 'An AceDataCloud application API token with Flux access',
    },
  ];
  authenticate: IAuthenticateGeneric = {
    type: 'generic', properties: { headers: { Authorization: '=Bearer {{$credentials.apiToken}}' } },
  };
  test: ICredentialTestRequest = {
    request: {
      baseURL: 'https://api.acedata.cloud', url: '/flux/tasks', method: 'POST',
      body: { action: 'retrieve_batch', ids: [] },
    },
  };
}
