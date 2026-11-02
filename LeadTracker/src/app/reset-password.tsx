import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import { supabase } from '@/lib/supabase';

function getLinkParameters(url: string): URLSearchParams {
  const parsed = new URL(url);
  const hash = parsed.hash.startsWith('#') ? parsed.hash.slice(1) : parsed.hash;
  return new URLSearchParams(`${parsed.search.slice(1)}&${hash}`);
}

export default function ResetPasswordScreen() {
  const incomingUrl = Linking.useLinkingURL();
  const [validating, setValidating] = useState(true);
  const [recoveryReady, setRecoveryReady] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    let active = true;

    const establishRecoverySession = async () => {
      if (!supabase || !incomingUrl) {
        if (active && !incomingUrl) setValidating(false);
        return;
      }

      try {
        const params = getLinkParameters(incomingUrl);
        const code = params.get('code');
        const accessToken = params.get('access_token');
        const refreshToken = params.get('refresh_token');
        const errorDescription =
          params.get('error_description') ?? params.get('error');

        if (errorDescription) {
          throw new Error(decodeURIComponent(errorDescription.replace(/\+/g, ' ')));
        }

        if (code) {
          const { error: exchangeError } =
            await supabase.auth.exchangeCodeForSession(code);
          if (exchangeError) throw exchangeError;
        } else if (accessToken && refreshToken) {
          const { error: sessionError } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (sessionError) throw sessionError;
        } else {
          throw new Error('This reset link is incomplete. Request a new one from the app.');
        }

        if (active) setRecoveryReady(true);
      } catch (cause) {
        if (active) {
          setError(
            cause instanceof Error
              ? cause.message
              : 'Could not verify the password reset link.',
          );
        }
      } finally {
        if (active) setValidating(false);
      }
    };

    void establishRecoverySession();
    return () => {
      active = false;
    };
  }, [incomingUrl]);

  const updatePassword = async () => {
    if (!supabase || busy) return;
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setError(null);
    setBusy(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    setSuccess(true);
  };

  if (validating) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.centered}>
            <ActivityIndicator color="#3157d5" size="large" />
          <Text style={styles.muted}>Verifying reset link…</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        style={styles.centered}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.card}>
          <Text style={styles.eyebrow}>LEADTRACKER</Text>
          <Text style={styles.title}>
            {success ? 'Password updated' : 'Reset password'}
          </Text>
          {success ? (
            <>
              <Text style={styles.muted}>
                Your password has been changed. Sign in with the new password.
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => router.replace('/')}
                style={styles.button}
              >
                <Text style={styles.buttonText}>Back to sign in</Text>
              </Pressable>
            </>
          ) : recoveryReady ? (
            <>
              <Text style={styles.muted}>Choose a new password for your account.</Text>
              <TextInput
                autoCapitalize="none"
                autoComplete="new-password"
                placeholder="New password (at least 8 characters)"
                placeholderTextColor={styles.placeholder.color}
                secureTextEntry
                style={styles.input}
                value={password}
                onChangeText={setPassword}
              />
              <TextInput
                autoCapitalize="none"
                autoComplete="new-password"
                placeholder="Confirm new password"
                placeholderTextColor={styles.placeholder.color}
                secureTextEntry
                style={styles.input}
                value={confirmPassword}
                onChangeText={setConfirmPassword}
              />
              {error ? <Text style={styles.error}>{error}</Text> : null}
              <Pressable
                accessibilityRole="button"
                disabled={busy || !password || !confirmPassword}
                onPress={updatePassword}
                style={({ pressed }) => [
                  styles.button,
                  (busy || !password || !confirmPassword) && styles.disabled,
                  pressed && styles.pressed,
                ]}
              >
                {busy ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.buttonText}>Update password</Text>
                )}
              </Pressable>
            </>
          ) : (
            <>
              <Text style={styles.muted}>
                This reset link is invalid or expired. Return to sign in and request
                a new link.
              </Text>
              {error ? <Text style={styles.error}>{error}</Text> : null}
              <Pressable
                accessibilityRole="button"
                onPress={() => router.replace('/')}
                style={styles.button}
              >
                <Text style={styles.buttonText}>Back to sign in</Text>
              </Pressable>
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#f4f6fb',
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
    gap: 12,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    alignSelf: 'center',
    backgroundColor: '#fff',
    borderRadius: 22,
    padding: 24,
    borderWidth: 1,
    borderColor: '#e4e7ec',
    gap: 14,
  },
  eyebrow: {
    color: '#3157d5',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.4,
  },
  title: {
    color: '#172033',
    fontSize: 26,
    fontWeight: '800',
  },
  muted: {
    color: '#667085',
    fontSize: 14,
    lineHeight: 21,
  },
  input: {
    minHeight: 50,
    borderWidth: 1,
    borderColor: '#e4e7ec',
    backgroundColor: '#fbfcfe',
    borderRadius: 12,
    paddingHorizontal: 14,
    color: '#172033',
    fontSize: 15,
  },
  placeholder: {
    color: '#98a2b3',
  },
  button: {
    minHeight: 50,
    borderRadius: 12,
    backgroundColor: '#3157d5',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  buttonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  disabled: {
    opacity: 0.55,
  },
  pressed: {
    backgroundColor: '#2546b8',
  },
  error: {
    color: '#b42318',
    fontSize: 13,
    lineHeight: 19,
  },
});
