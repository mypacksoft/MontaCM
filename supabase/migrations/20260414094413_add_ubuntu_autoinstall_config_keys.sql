/*
  # Add Ubuntu Autoinstall system_config keys

  Adds two new configuration keys used by the Ubuntu autoinstall (subiquity) provisioning flow:

  - `ubuntu_iso_path`: Path to Ubuntu live-server ISO on the Hyper-V host
  - `default_user_password_hash`: SHA-512 password hash for the default VM user
*/

INSERT INTO system_config (key, value, description) VALUES
  (
    'ubuntu_iso_path',
    '',
    'Full path to Ubuntu live-server ISO on the Hyper-V host (e.g. E:\YSDB\ubuntu-24.04.4-live-server-amd64.iso)'
  ),
  (
    'default_user_password_hash',
    '',
    'SHA-512 password hash for the default user. Generate with: python3 -c "import crypt; print(crypt.crypt(''password'', crypt.mksalt(crypt.METHOD_SHA512)))"'
  )
ON CONFLICT (key) DO NOTHING;
