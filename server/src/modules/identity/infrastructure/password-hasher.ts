import { hash, verify } from '@node-rs/argon2';

// argon2id with the library's defaults.
export const hashPassword = (password: string) => hash(password);
export const verifyPassword = (passwordHash: string, password: string) => verify(passwordHash, password).catch(() => false);
