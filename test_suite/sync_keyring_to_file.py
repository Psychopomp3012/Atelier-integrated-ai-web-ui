#!/usr/bin/env python3
import dbus
import json
import os
import sys

def sync_keyring_to_file():
    try:
        bus = dbus.SessionBus()
        service = bus.get_object('org.freedesktop.secrets', '/org/freedesktop/secrets')
        service_iface = dbus.Interface(service, 'org.freedesktop.Secret.Service')
        _, session_path = service_iface.OpenSession('plain', '')

        collection = bus.get_object('org.freedesktop.secrets', '/org/freedesktop/secrets/aliases/default')
        col_iface = dbus.Interface(collection, 'org.freedesktop.Secret.Collection')
        items = col_iface.Get('org.freedesktop.Secret.Collection', 'Items', dbus_interface='org.freedesktop.DBus.Properties')

        agy_secret_bytes = None
        for item_path in items:
            item = bus.get_object('org.freedesktop.secrets', item_path)
            props_iface = dbus.Interface(item, 'org.freedesktop.DBus.Properties')
            attrs = props_iface.Get('org.freedesktop.Secret.Item', 'Attributes')
            if attrs.get('service') == 'gemini' and attrs.get('username') == 'antigravity':
                item_iface = dbus.Interface(item, 'org.freedesktop.Secret.Item')
                secret_struct = item_iface.GetSecret(session_path)
                agy_secret_bytes = bytes(secret_struct[2])
                break

        if not agy_secret_bytes:
            print("No antigravity secret found in keyring")
            return False

        # Validate that it is valid JSON
        data = json.loads(agy_secret_bytes.decode('utf-8'))
        if not data.get('token') and not data.get('refresh_token'):
            print("Secret does not contain valid token format")
            return False

        homedir = os.path.expanduser('~')
        cache_dir = os.path.join(homedir, '.gemini', 'antigravity-cli', 'cache')
        cli_dir = os.path.join(homedir, '.gemini', 'antigravity-cli')
        os.makedirs(cache_dir, mode=0o700, exist_ok=True)

        target1 = os.path.join(cache_dir, 'antigravity-keyring-unavailable-oauth-token')
        target2 = os.path.join(cli_dir, 'antigravity-oauth-token')
        target3 = os.path.join(cache_dir, 'antigravity-oauth-token')

        for target in [target1, target2, target3]:
            with open(target, 'wb') as f:
                f.write(agy_secret_bytes)
            os.chmod(target, 0o600)

        print(f"Successfully synced genuine Antigravity token to {target1}")
        return True
    except Exception as e:
        print(f"Error syncing keyring: {e}", file=sys.stderr)
        return False

if __name__ == '__main__':
    ok = sync_keyring_to_file()
    sys.exit(0 if ok else 1)
