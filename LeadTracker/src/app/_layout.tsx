import { Stack } from 'expo-router';

const RootLayout = () => {
  return (
    <Stack>
      <Stack.Screen name="index" options={{ title: 'LeadTracker' }} />
      <Stack.Screen
        name="reset-password"
        options={{ title: 'Reset password' }}
      />
    </Stack>
  );
};

export default RootLayout;