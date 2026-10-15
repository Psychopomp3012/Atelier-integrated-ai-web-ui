import { z } from 'zod';

export const LoginWithPlatformSchema = z.object({
  platform: z.enum([
    'openai',
    'anthropic',
    'google',
    'claude_subscription',
    'codex_subscription',
    'custom',
  ]),
  authCode: z.string().optional(),
  apiKey: z.string().optional(),
  email: z.string().email().optional(),
  name: z.string().optional(),
});

export type LoginWithPlatformInput = z.infer<typeof LoginWithPlatformSchema>;

export const GoogleLoginSchema = z.object({
  idToken: z.string({ required_error: 'Google ID token (credential) is required' }).min(1),
  email: z.string().email().optional(),
  name: z.string().optional(),
  avatarUrl: z.string().optional(),
});

export type GoogleLoginInput = z.infer<typeof GoogleLoginSchema>;

export const DeviceAuthInitiateSchema = z.object({
  platform: z.enum(['claude_subscription', 'codex_subscription']),
});

export type DeviceAuthInitiateInput = z.infer<typeof DeviceAuthInitiateSchema>;

export const DeviceAuthVerifySchema = z.object({
  deviceCode: z.string().min(1, 'Device code is required'),
  platform: z.enum(['claude_subscription', 'codex_subscription']),
});

export type DeviceAuthVerifyInput = z.infer<typeof DeviceAuthVerifySchema>;

export const ConnectPlatformSchema = z.object({
  platform: z.enum([
    'openai',
    'anthropic',
    'google',
    'claude_subscription',
    'codex_subscription',
    'custom',
  ]),
  apiKey: z.string().optional(),
  authCode: z.string().optional(),
});

export type ConnectPlatformInput = z.infer<typeof ConnectPlatformSchema>;
