   npm install --save-dev typescript @types/react @types/node
   ```
2. **יצירת `tsconfig.json`** (בשורש הפרויקט):
   ```json
   {
     "compilerOptions": {
       "target": "es5",
       "lib": ["dom", "dom.iterable", "esnext"],
       "allowJs": true,
       "skipLibCheck": true,
       "strict": true,
       "noEmit": true,
       "esModuleInterop": true,
       "module": "esnext",
       "moduleResolution": "bundler",
       "resolveJsonModule": true,
       "isolatedModules": true,
       "jsx": "preserve",
       "incremental": true,
       "plugins": [{ "name": "next" }],
       "paths": { "@/*": ["./*"] }
     },
     "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
     "exclude": ["node_modules"]
   }
   ```
3. **יצירת `next-env.d.ts`** (אם לא קיים):
   ```typescript
   /// <reference types="next" />
   /// <reference types="next/image-types/global" />
   ```

---

### שלב 1: המרת `lib/agent.js` → `lib/agent.ts` (1-2 שעות)

#### קוד לדוגמה (`lib/agent.ts`):