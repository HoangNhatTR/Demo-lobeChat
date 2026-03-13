INSERT INTO applications (tenant_id, id, name, secret, description, type, oidc_client_metadata, custom_client_metadata, custom_data, is_third_party, created_at)
VALUES (
  'default',
  'lobechat-app',
  'LobeChat',
  'kLPFa3mSfYhBQ4AgwdvuXTDGzb9cVp0K',
  'LobeChat Web App',
  'Traditional',
  '{"redirectUris":["http://localhost:3210/api/auth/callback/logto"],"postLogoutRedirectUris":["http://localhost:3210/"]}',
  '{}',
  '{}',
  false,
  now()
) ON CONFLICT (id) DO NOTHING;
