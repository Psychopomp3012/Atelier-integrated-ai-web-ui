import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { cliAuthService } from '../backend/src/modules/auth/cli-auth.service.js';
import { authService } from '../backend/src/modules/auth/auth.service.js';

async function runTests() {
  console.log('====================================================');
  console.log('🧪 RUNNING ANTIGRAVITY LINK / UNLINK INTEGRATION TESTS');
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      console.log(`✅ PASS: ${testName}`);
      passed++;
    } else {
      console.error(`❌ FAIL: ${testName} - ${detail || ''}`);
      failed++;
    }
  }

  // 1. Initial State Check
  console.log('--- TEST 1: Initial Service Status ---');
  const initialStatus = cliAuthService.getCliStatus();
  console.log('Initial status:', JSON.stringify(initialStatus.antigravity, null, 2));
  assert(typeof initialStatus.antigravity.linked === 'boolean', 'initialStatus.antigravity has linked boolean');

  // 2. Test startAntigravityCliLogin returns real Google OAuth URL
  console.log('\n--- TEST 2: Antigravity CLI Login URL Generation ---');
  try {
    const loginRes = await cliAuthService.startAntigravityCliLogin();
    console.log('Login result URL:', loginRes.authUrl.substring(0, 80) + '...');
    assert(
      loginRes.authUrl.includes('https://accounts.google.com/o/oauth2/auth'),
      'authUrl points to Google OAuth endpoint'
    );
    assert(
      loginRes.authUrl.includes('client_id=1071006060591'),
      'authUrl uses official Antigravity client ID'
    );
    assert(
      loginRes.authUrl.includes('redirect_uri=https%3A%2F%2Fantigravity.google%2Foauth-callback'),
      'authUrl redirects to official Antigravity callback'
    );
    assert(
      loginRes.authUrl.includes('code_challenge='),
      'authUrl includes PKCE code challenge'
    );
  } catch (err) {
    assert(false, 'startAntigravityCliLogin', String(err));
  }

  // 3. Test syncAntigravityCredentials
  console.log('\n--- TEST 3: Synchronize Antigravity Credentials ---');
  const syncResult = cliAuthService.syncAntigravityCredentials();
  console.log('syncResult:', syncResult);
  const postSyncStatus = cliAuthService.getCliStatus();
  console.log('Post-sync status:', JSON.stringify(postSyncStatus.antigravity, null, 2));

  // 4. Test Unlink
  console.log('\n--- TEST 4: Unlink Antigravity ---');
  cliAuthService.unlinkAntigravity();
  const unlinkedStatus = cliAuthService.getCliStatus();
  console.log('Unlinked status:', JSON.stringify(unlinkedStatus.antigravity, null, 2));
  assert(unlinkedStatus.antigravity.linked === false, 'Antigravity status reports linked: false after unlink');
  assert(!unlinkedStatus.antigravity.email, 'Antigravity email is undefined after unlink');

  // Verify files were actually removed
  const geminiCreds = path.join(os.homedir(), '.gemini', 'oauth_creds.json');
  const agyCreds = path.join(os.homedir(), '.gemini', 'antigravity-cli', 'oauth_creds.json');
  const userInfo = path.join(os.homedir(), '.gemini', 'user_info.json');
  assert(!fs.existsSync(geminiCreds), '~/.gemini/oauth_creds.json removed');
  assert(!fs.existsSync(agyCreds), '~/.gemini/antigravity-cli/oauth_creds.json removed');
  assert(!fs.existsSync(userInfo), '~/.gemini/user_info.json removed');

  // 5. Test Re-linking via sync if backup/snap creds exist
  console.log('\n--- TEST 5: Re-link via Sync ---');
  const resyncResult = cliAuthService.syncAntigravityCredentials();
  console.log('Re-sync result:', resyncResult);
  const relinkedStatus = cliAuthService.getCliStatus();
  console.log('Re-linked status:', JSON.stringify(relinkedStatus.antigravity, null, 2));

  // 6. Test HTTP API Endpoints directly on running backend
  console.log('\n--- TEST 6: HTTP Endpoints Validation ---');
  try {
    // Test URL endpoint
    const urlRes = await fetch('http://127.0.0.1:4000/api/v1/auth/cli/antigravity/url');
    assert(urlRes.ok, 'GET /api/v1/auth/cli/antigravity/url returns 200');
    const urlData = await urlRes.json() as any;
    assert(Boolean(urlData.data?.authUrl), 'URL response contains authUrl');

    // Test Unlink endpoint
    const unlinkRes = await fetch('http://127.0.0.1:4000/api/v1/auth/cli/antigravity/unlink', {
      method: 'POST'
    });
    assert(unlinkRes.ok, 'POST /api/v1/auth/cli/antigravity/unlink returns 200');
    const unlinkData = await unlinkRes.json() as any;
    assert(unlinkData.success === true, 'Unlink response reports success: true');

    // Test Code endpoint validation (empty code error)
    const codeEmptyRes = await fetch('http://127.0.0.1:4000/api/v1/auth/cli/antigravity/code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: '' })
    });
    assert(codeEmptyRes.status === 400, 'POST /api/v1/auth/cli/antigravity/code with empty code returns 400');
  } catch (err) {
    assert(false, 'HTTP Endpoints Validation', String(err));
  }

  console.log('\n====================================================');
  console.log(`🏁 TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('====================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
