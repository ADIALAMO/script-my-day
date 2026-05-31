import _NextAuth from 'next-auth';
import { authOptions } from '../../../lib/auth.js';

const NextAuth = _NextAuth.default ?? _NextAuth;

export default NextAuth(authOptions);
