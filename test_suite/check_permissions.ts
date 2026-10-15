import { Sandbox } from 'e2b';

async function main() {
  const sandbox = await Sandbox.connect('iyb69eqlm6s8zp285vkzp');
  console.log('Connected to sandbox!');

  try {
    await sandbox.files.write('/home/agent-runner/.gemini/test_write.txt', 'test');
    console.log('Direct write SUCCEEDED!');
  } catch (err: any) {
    console.log('Direct write FAILED:', err.message);
  }
}

main();
