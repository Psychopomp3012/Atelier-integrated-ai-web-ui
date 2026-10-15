import { E2BSandboxProvider } from '../backend/src/modules/sandbox/e2b-sandbox.provider.js';

async function main() {
  const provider = new E2BSandboxProvider();
  console.log('Testing executeCliInSandbox with agy on sandbox iyb69eqlm6s8zp285vkzp...');

  let streamedTokens = '';
  const res = await provider.executeCliInSandbox({
    cli: 'agy',
    prompt: 'Check ram rom and vCPUs of current directory',
    sessionId: 'test_session_verification',
    sandboxId: 'iyb69eqlm6s8zp285vkzp',
    userId: 'default_user',
    onToken: (tok) => {
      streamedTokens += tok;
      process.stdout.write(tok);
    },
  });

  console.log('\n=== EXECUTION RESULT ===');
  console.log('exitCode:', res.exitCode);
  console.log('durationMs:', res.durationMs);
  console.log('usage:', JSON.stringify(res.usage));
  console.log('text length:', res.text.length);
  console.log('=== FULL ACCUMULATED TEXT ===\n', res.text);
}

main().catch(console.error);
