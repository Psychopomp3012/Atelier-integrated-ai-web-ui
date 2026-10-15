import { CliAuthService } from '../backend/src/modules/auth/cli-auth.service';

const authService = new CliAuthService();
const status = authService.getCliStatus();
console.log('CLI STATUS:', JSON.stringify(status, null, 2));
