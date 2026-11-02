import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
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
import type { Session } from '@supabase/supabase-js';
import { supabase, supabaseConfigError } from '@/lib/supabase';
import type { Lead } from '@/lib/lead-types';

const MAX_LEADS = 100;

function mergeLeads(current: Lead[], incoming: Lead[]): Lead[] {
  const byId = new Map(current.map((lead) => [lead.id, lead]));
  for (const lead of incoming) byId.set(lead.id, lead);

  return Array.from(byId.values())
    .sort(
      (left, right) =>
        new Date(right.received_at).getTime() -
        new Date(left.received_at).getTime(),
    )
    .slice(0, MAX_LEADS);
}

function formatDate(value: string | null): string {
  if (!value) return 'Time unavailable';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Time unavailable';
  return date.toLocaleString();
}

function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const signIn = async () => {
    const client = supabase;
    if (!client || busy) return;
    setError(null);
    setMessage(null);
    setBusy(true);
    const { error: signInError } = await client.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    setBusy(false);
    if (signInError) setError(signInError.message);
  };

  const sendPasswordReset = async () => {
    const client = supabase;
    const normalizedEmail = email.trim();
    if (!client || busy || !normalizedEmail) return;

    setError(null);
    setMessage(null);
    setBusy(true);
    const { error: resetError } = await client.auth.resetPasswordForEmail(
      normalizedEmail,
      { redirectTo: Linking.createURL('reset-password') },
    );
    setBusy(false);

    if (resetError) {
      setError(resetError.message);
      return;
    }
    setMessage('If an account exists for that email, a reset link has been sent.');
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        style={styles.centered}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.loginCard}>
          <Text style={styles.eyebrow}>LEADTRACKER</Text>
          <Text style={styles.title}>Sign in</Text>
          <Text style={styles.muted}>
            Sign in to view incoming Meta leads.
          </Text>
          <TextInput
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            placeholder="Email"
            placeholderTextColor={colors.subtle}
            style={styles.input}
            value={email}
            onChangeText={setEmail}
          />
          <TextInput
            autoCapitalize="none"
            autoComplete="password"
            placeholder="Password"
            placeholderTextColor={colors.subtle}
            secureTextEntry
            style={styles.input}
            value={password}
            onChangeText={setPassword}
          />
          <Pressable
            accessibilityRole="button"
            disabled={busy || !email.trim()}
            onPress={sendPasswordReset}
            style={({ pressed }) => [
              styles.resetLinkButton,
              (busy || !email.trim()) && styles.disabledButton,
              pressed && styles.resetLinkPressed,
            ]}
          >
            <Text style={styles.resetLinkText}>Forgot password?</Text>
          </Pressable>
          {error ? <Text style={styles.errorText}>{error}</Text> : null}
          {message ? <Text style={styles.successText}>{message}</Text> : null}
          <Pressable
            accessibilityRole="button"
            disabled={busy || !email.trim() || !password}
            onPress={signIn}
            style={({ pressed }) => [
              styles.primaryButton,
              (busy || !email.trim() || !password) && styles.disabledButton,
              pressed && styles.pressedButton,
            ]}
          >
            {busy ? (
              <ActivityIndicator color={colors.surface} />
            ) : (
              <Text style={styles.primaryButtonText}>Sign in</Text>
            )}
          </Pressable>
          <Text style={styles.loginHint}>
            Accounts are created by the project administrator.
          </Text>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function LeadCard({ lead, isNew }: { lead: Lead; isNew: boolean }) {
  const title = lead.name?.trim() || 'New lead';
  const details = [lead.email, lead.phone].filter(
    (value): value is string => Boolean(value?.trim()),
  );

  return (
    <View style={styles.leadCard}>
      <View style={styles.leadTopRow}>
        <Text style={styles.leadName}>{title}</Text>
        {isNew ? (
          <View style={styles.newBadge}>
            <Text style={styles.newBadgeText}>NEW</Text>
          </View>
        ) : null}
      </View>
      {details.map((detail) => (
        <Text key={detail} style={styles.leadDetail}>
          {detail}
        </Text>
      ))}
      <Text style={styles.leadMeta}>
        {lead.form_id ? `Form ${lead.form_id}  ·  ` : ''}
        Received {formatDate(lead.received_at)}
      </Text>
    </View>
  );
}

function LeadsDashboard({ session }: { session: Session }) {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [connection, setConnection] = useState<
    'connecting' | 'connected' | 'disconnected'
  >('connecting');
  const [newestLeadId, setNewestLeadId] = useState<string | null>(null);

  useEffect(() => {
    const client = supabase;
    if (!client) return;
    let active = true;

    const channel = client
      .channel(`leads-live-${session.user.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'leads' },
        (payload) => {
          const incoming = payload.new as Lead;
          if (!incoming.id || !incoming.received_at) return;
          setLeads((current) => mergeLeads(current, [incoming]));
          setNewestLeadId(incoming.id);
        },
      )
      .subscribe((status) => {
        if (!active) return;
        if (status === 'SUBSCRIBED') {
          setConnection('connected');
        } else if (
          status === 'CHANNEL_ERROR' ||
          status === 'TIMED_OUT' ||
          status === 'CLOSED'
        ) {
          setConnection('disconnected');
        }
      });

    const loadLeads = async () => {
      setLoading(true);
      setLoadError(null);
      const { data, error } = await client
        .from('leads')
        .select(
          'id, meta_lead_id, name, email, phone, form_id, submitted_at, received_at',
        )
        .order('received_at', { ascending: false })
        .limit(MAX_LEADS);

      if (!active) return;
      setLoading(false);
      if (error) {
        setLoadError(
          `${error.message} Check the authenticated SELECT policy on public.leads.`,
        );
        return;
      }
      setLeads((current) => mergeLeads(current, data as Lead[]));
    };

    void loadLeads();

    return () => {
      active = false;
      void client.removeChannel(channel);
    };
  }, [session.user.id]);

  const signOut = async () => {
    const client = supabase;
    if (!client) return;
    const { error } = await client.auth.signOut();
    if (error) setLoadError(error.message);
  };

  const statusLabel = useMemo(() => {
    if (connection === 'connected') return 'Live';
    if (connection === 'connecting') return 'Connecting';
    return 'Reconnecting';
  }, [connection]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <FlatList
        contentContainerStyle={styles.listContent}
        data={leads}
        keyExtractor={(lead) => lead.id}
        ListEmptyComponent={
          loading ? (
            <View style={styles.emptyState}>
              <ActivityIndicator color={colors.primary} />
              <Text style={styles.muted}>Loading leads…</Text>
            </View>
          ) : (
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>No leads yet</Text>
              <Text style={styles.muted}>
                Submit a test lead with Meta’s Lead Ads Testing Tool. New leads
                will appear here automatically.
              </Text>
            </View>
          )
        }
        ListHeaderComponent={
          <View style={styles.header}>
            <View style={styles.headerTop}>
              <View>
                <Text style={styles.eyebrow}>LEADTRACKER</Text>
                <Text style={styles.title}>Meta leads</Text>
              </View>
              <Pressable
                accessibilityRole="button"
                onPress={signOut}
                style={styles.signOutButton}
              >
                <Text style={styles.signOutText}>Sign out</Text>
              </Pressable>
            </View>
            <View style={styles.summaryCard}>
              <View>
                <Text style={styles.summaryLabel}>TOTAL RECEIVED</Text>
                <Text style={styles.count}>{leads.length}</Text>
              </View>
              <View style={styles.connectionPill}>
                <View
                  style={[
                    styles.connectionDot,
                    connection !== 'connected' && styles.connectionDotOff,
                  ]}
                />
                <Text style={styles.connectionText}>{statusLabel}</Text>
              </View>
            </View>
            <Text style={styles.sectionTitle}>Recent leads</Text>
            {loadError ? (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{loadError}</Text>
              </View>
            ) : null}
          </View>
        }
        renderItem={({ item }) => (
          <LeadCard lead={item} isNew={item.id === newestLeadId} />
        )}
      />
    </SafeAreaView>
  );
}

export default function Index() {
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(() => Boolean(supabase));

  useEffect(() => {
    const client = supabase;
    if (!client) return;
    let active = true;

    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((_event, nextSession) => {
      if (!active) return;
      setSession(nextSession);
      setAuthLoading(false);
    });

    void client.auth.getSession().then(({ data, error }) => {
      if (!active) return;
      if (error) console.error('Could not restore auth session', error.message);
      setSession(data.session);
      setAuthLoading(false);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  if (supabaseConfigError) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.centered}>
          <View style={styles.loginCard}>
            <Text style={styles.title}>Setup needed</Text>
            <Text style={styles.errorText}>{supabaseConfigError}</Text>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  if (authLoading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.centered}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      </SafeAreaView>
    );
  }

  return session ? <LeadsDashboard session={session} /> : <LoginScreen />;
}

const colors = {
  background: '#f4f6fb',
  surface: '#ffffff',
  text: '#172033',
  muted: '#667085',
  subtle: '#98a2b3',
  border: '#e4e7ec',
  primary: '#3157d5',
  primaryDark: '#2546b8',
  success: '#138a57',
  successBackground: '#e8f7ef',
  error: '#b42318',
  errorBackground: '#fff1f0',
  newBackground: '#eef2ff',
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  loginCard: {
    width: '100%',
    maxWidth: 420,
    alignSelf: 'center',
    backgroundColor: colors.surface,
    borderRadius: 22,
    padding: 24,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 14,
  },
  eyebrow: {
    color: colors.primary,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.4,
  },
  title: {
    color: colors.text,
    fontSize: 28,
    fontWeight: '800',
  },
  muted: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 21,
  },
  input: {
    minHeight: 50,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: '#fbfcfe',
    borderRadius: 12,
    paddingHorizontal: 14,
    color: colors.text,
    fontSize: 15,
  },
  primaryButton: {
    minHeight: 50,
    borderRadius: 12,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  primaryButtonText: {
    color: colors.surface,
    fontSize: 15,
    fontWeight: '700',
  },
  disabledButton: {
    opacity: 0.55,
  },
  pressedButton: {
    backgroundColor: colors.primaryDark,
  },
  loginHint: {
    color: colors.muted,
    fontSize: 12,
    textAlign: 'center',
  },
  errorText: {
    color: colors.error,
    fontSize: 13,
    lineHeight: 19,
  },
  successText: {
    color: colors.success,
    fontSize: 13,
    lineHeight: 19,
  },
  resetLinkButton: {
    alignSelf: 'flex-end',
    paddingVertical: 4,
  },
  resetLinkPressed: {
    opacity: 0.7,
  },
  resetLinkText: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '600',
  },
  listContent: {
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 36,
    width: '100%',
    maxWidth: 600,
    alignSelf: 'center',
  },
  header: {
    marginBottom: 16,
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  signOutButton: {
    paddingHorizontal: 13,
    paddingVertical: 9,
    borderRadius: 10,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  signOutText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '600',
  },
  summaryCard: {
    backgroundColor: colors.surface,
    borderRadius: 18,
    padding: 20,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 26,
  },
  summaryLabel: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.1,
  },
  count: {
    color: colors.text,
    fontSize: 34,
    fontWeight: '800',
    marginTop: 5,
  },
  connectionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.successBackground,
    borderRadius: 20,
    paddingHorizontal: 11,
    paddingVertical: 7,
    gap: 7,
  },
  connectionDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.success,
  },
  connectionDotOff: {
    backgroundColor: '#d18b00',
  },
  connectionText: {
    color: colors.success,
    fontSize: 12,
    fontWeight: '700',
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 12,
  },
  errorBox: {
    padding: 12,
    borderRadius: 12,
    backgroundColor: colors.errorBackground,
    marginBottom: 12,
  },
  emptyState: {
    minHeight: 170,
    backgroundColor: colors.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 24,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 10,
  },
  emptyTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '700',
  },
  leadCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    marginBottom: 10,
  },
  leadTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    marginBottom: 7,
  },
  leadName: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
    flexShrink: 1,
  },
  newBadge: {
    backgroundColor: colors.newBackground,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  newBadgeText: {
    color: colors.primary,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  leadDetail: {
    color: colors.muted,
    fontSize: 14,
    marginTop: 3,
  },
  leadMeta: {
    color: colors.subtle,
    fontSize: 11,
    marginTop: 12,
  },
});
