# Welcome to your Expo app 👋

This is an [Expo](https://expo.dev) project created with [`create-expo-app`](https://www.npmjs.com/package/create-expo-app).

## Meta Leads PoC setup

The app signs in with Supabase Auth, loads the latest 100 rows from `public.leads`,
and subscribes to Realtime `INSERT` events. The Meta webhook writes leads to
that table; the mobile app must never contain the Meta access token or the
Supabase service-role key.

1. Copy `.env.example` to `.env.local` and set `EXPO_PUBLIC_SUPABASE_ANON_KEY`
   to the project's publishable key. The URL in the example is for the linked
   project. Only public client configuration belongs in this file.
2. In the Supabase SQL Editor, run `supabase/setup-authenticated-lead-read.sql`
   once. It grants `SELECT` to signed-in users only; it does not permit public
   anonymous access.
3. In Supabase Auth settings, disable public sign-ups for this PoC. In
   **Authentication → Users**, create a user for each authorized app user.
   Sign in to the app with that user's email and password.
4. Confirm `public.leads` is enabled in the `supabase_realtime` publication.
5. In Supabase **Authentication → URL Configuration → Redirect URLs**, add
   `leadtracker://reset-password` for an installed native build. For web/Expo
   Go, also allow the exact redirect URL shown by `Linking.createURL` for the
   running development server (commonly an Expo `exp://.../--/reset-password`
   URL in Expo Go or `http://localhost:8081/reset-password` on web). The
   sign-in screen sends recovery links to the current runtime's redirect URL;
   the reset screen establishes the recovery session and lets the user choose
   a new password. Keep the development server running when testing a localhost
   web redirect.
6. Restart Expo after adding `.env.local`:

   ```bash
   npx expo start
   ```

7. Keep the app open, sign in, then create a test lead with Meta's Lead Ads
   Testing Tool. A successful webhook insert should appear in the app without
   refreshing.

The dashboard shows an error if the authenticated `SELECT` policy is missing.
The `supabase/functions/meta-webhook` Edge Function separately requires its
Meta and Supabase server-side secrets to be configured in Supabase; never put
those secrets in `.env.local`.

## Get started

1. Install dependencies

   ```bash
   npm install
   ```

2. Start the app

   ```bash
   npx expo start
   ```

In the output, you'll find options to open the app in a

- [development build](https://docs.expo.dev/develop/development-builds/introduction/)
- [Android emulator](https://docs.expo.dev/workflow/android-studio-emulator/)
- [iOS simulator](https://docs.expo.dev/workflow/ios-simulator/)
- [Expo Go](https://expo.dev/go), a limited sandbox for trying out app development with Expo

You can start developing by editing the files inside the **app** directory. This project uses [file-based routing](https://docs.expo.dev/router/introduction).

## Get a fresh project

When you're ready, run:

```bash
npm run reset-project
```

This command will move the starter code to the **app-example** directory and create a blank **app** directory where you can start developing.

### Other setup steps

- To set up ESLint for linting, run `npx expo lint`, or follow our guide on ["Using ESLint and Prettier"](https://docs.expo.dev/guides/using-eslint/)
- If you'd like to set up unit testing, follow our guide on ["Unit Testing with Jest"](https://docs.expo.dev/develop/unit-testing/)
- Learn more about the TypeScript setup in this template in our guide on ["Using TypeScript"](https://docs.expo.dev/guides/typescript/)

## Learn more

To learn more about developing your project with Expo, look at the following resources:

- [Expo documentation](https://docs.expo.dev/): Learn fundamentals, or go into advanced topics with our [guides](https://docs.expo.dev/guides).
- [Learn Expo tutorial](https://docs.expo.dev/tutorial/introduction/): Follow a step-by-step tutorial where you'll create a project that runs on Android, iOS, and the web.

## Join the community

Join our community of developers creating universal apps.

- [Expo on GitHub](https://github.com/expo/expo): View our open source platform and contribute.
- [Discord community](https://chat.expo.dev): Chat with Expo users and ask questions.
