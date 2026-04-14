-- =============================================================================
-- Migration 002 - Ubuntu Autoinstall config keys
-- =============================================================================
-- Adds system_config keys required for automated Ubuntu installation via
-- subiquity autoinstall (used when provisioning VMs from a live-server ISO).
--
-- New keys:
--   ubuntu_iso_path          - Full path to Ubuntu ISO on the Hyper-V host
--   default_user_password_hash - SHA-512 hash of the default VM user password
-- =============================================================================

INSERT INTO system_config (key, value, description) VALUES
  (
    'ubuntu_iso_path',
    '',
    'Full path to Ubuntu live-server ISO on the Hyper-V host (e.g. E:\YSDB\ubuntu-24.04.4-live-server-amd64.iso)'
  ),
  (
    'default_user_password_hash',
    '',
    'SHA-512 password hash for the default VM user. Generate with: python3 -c "import crypt; print(crypt.crypt(''password'', crypt.mksalt(crypt.METHOD_SHA512)))"'
  )
ON CONFLICT (key) DO NOTHING;
