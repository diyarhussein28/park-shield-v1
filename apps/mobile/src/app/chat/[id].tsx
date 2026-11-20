import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  AppState,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Banner, Button, useTheme } from '@/components/ui';
import { api } from '@/lib/api';
import { useChat, type ChatError } from '@/lib/chat';
import { lang, t, type Key } from '@/lib/i18n';
import { looksPersonal } from '@/lib/personal';

/**
 * The owner's chat with the scanner. Text only, 500 characters, 20 messages per side; quick replies;
 * a warning before personal data; "Erledigt" ends it for both sides.
 */
export default function Chat() {
  const c = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const chat = useChat(id, true);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const list = useRef<FlatList>(null);
  const status = chat.state?.status;
  const active = status === 'active';
  const max = chat.state?.limits.maxChars ?? 500;
  const mine = chat.messages.filter((m) => m.from === 'owner').length;
  // Only the person at the vehicle has a limit by default; the owner one only if ops sets it.
  const cap = chat.state?.limits.maxOwnerMessages ?? 0;
  const remaining = cap > 0 ? Math.max(0, cap - mine) : null;

  // iOS: returning from the background with the keyboard open, KeyboardAvoidingView measures the
  // keyboard wrongly (the list collapses, the composer overlaps itself). So the keyboard closes when
  // the app leaves, and the layout is rebuilt once when it comes back; the typed text stays.
  const [layoutKey, setLayoutKey] = useState(0);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'background') Keyboard.dismiss();
      else if (st === 'active') setLayoutKey((k) => k + 1);
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (chat.messages.length) {
      list.current?.scrollToEnd({ animated: true });
      chat.seen();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat.messages.length, layoutKey]);

  const deliver = async (value: string) => {
    setBusy(true);
    const r = await chat.send(value);
    setBusy(false);
    if (r.ok) {
      setText('');
      chat.setTyping(false);
    }
  };

  const send = (value: string) => {
    const v = value.trim();
    if (!v || !active) return;
    if (looksPersonal(v)) {
      Alert.alert(t('chatPersonalTitle'), t('chatPersonalText'), [
        { text: t('chatPersonalCancel'), style: 'cancel' },
        { text: t('chatPersonalSend'), onPress: () => void deliver(v) },
      ]);
      return;
    }
    void deliver(v);
  };

  const close = async () => {
    await api(`/v1/app/alerts/${id}/chat/close`, { body: {} }).catch(() => undefined);
    router.back();
  };

  const time = (iso: string) =>
    new Intl.DateTimeFormat(lang(), { hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
  const errorKey = (e: ChatError) => `chatErr_${e}` as Key;

  return (
    <SafeAreaView style={[s.flex, { backgroundColor: c.bg }]} edges={['bottom', 'left', 'right']}>
      <KeyboardAvoidingView
        key={layoutKey}
        style={s.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={90}
      >
        <FlatList
          ref={list}
          // The list gives way to the keyboard; the composer below never shrinks.
          style={s.flex}
          contentInsetAdjustmentBehavior="automatic"
          data={chat.messages}
          keyExtractor={(m) => m.id}
          contentContainerStyle={s.log}
          accessibilityLiveRegion="polite"
          renderItem={({ item: m }) => (
            <View
              style={[
                s.bubble,
                m.from === 'owner'
                  ? { alignSelf: 'flex-end', backgroundColor: c.primary }
                  : {
                      alignSelf: 'flex-start',
                      backgroundColor: c.surface,
                      borderColor: c.border,
                      borderWidth: 1,
                    },
              ]}
            >
              <Text style={{ color: m.from === 'owner' ? c.primaryFg : c.muted, fontSize: 13 }}>
                {m.from === 'owner' ? t('chatYou') : t('chatScanner')} · {time(m.at)}
              </Text>
              <Text style={{ color: m.from === 'owner' ? c.primaryFg : c.fg, fontSize: 17 }}>
                {m.text}
              </Text>
            </View>
          )}
          ListFooterComponent={
            <View style={s.footer}>
              {chat.typing && <Text style={{ color: c.muted }}>{t('chatTyping')}</Text>}
              {chat.readAt && chat.messages.some((m) => m.from === 'owner') && (
                <Text style={{ color: c.muted, alignSelf: 'flex-end' }}>{t('chatRead')}</Text>
              )}
              {status === 'closed' && <Banner tone="info">{t('chatClosed')}</Banner>}
              {chat.error && <Banner tone="err">{t(errorKey(chat.error))}</Banner>}
              {!chat.connected && status !== 'closed' && (
                <Banner tone="warn">
                  {chat.connectError ? `${t('offline')} (${chat.connectError})` : t('offline')}
                </Banner>
              )}
            </View>
          }
        />
        {active && (
          <View style={[s.composer, { borderTopColor: c.border }]}>
            <View style={s.quick}>
              {(chat.state?.quickReplies ?? []).map((q) => (
                <Pressable
                  key={q}
                  accessibilityRole="button"
                  onPress={() => send(q)}
                  style={[s.chip, { borderColor: c.primary }]}
                >
                  <Text style={{ color: c.primary, fontWeight: '600' }}>{q}</Text>
                </Pressable>
              ))}
            </View>
            <TextInput
              accessibilityLabel={t('chatPlaceholder')}
              placeholder={t('chatPlaceholder')}
              placeholderTextColor={c.muted}
              value={text}
              maxLength={max}
              multiline
              onChangeText={(v) => {
                setText(v);
                chat.setTyping(v.length > 0);
              }}
              style={[s.input, { color: c.fg, borderColor: c.borderStrong }]}
              testID="chat-input"
            />
            <Text style={{ color: c.muted }}>
              {text.length} / {max}
              {remaining !== null ? ` · ${t('chatRemaining', { count: remaining })}` : ''}
            </Text>
            <Button
              label={t('chatSend')}
              onPress={() => send(text)}
              busy={busy}
              disabled={!text.trim() || remaining === 0}
              testID="chat-send"
            />
            <Button label={t('chatClose')} variant="secondary" onPress={() => void close()} />
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1 },
  log: { padding: 16, gap: 8 },
  bubble: { maxWidth: '85%', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 8, gap: 2 },
  footer: { gap: 8, marginTop: 8 },
  composer: { borderTopWidth: 1, padding: 12, gap: 8, flexShrink: 0 },
  quick: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    borderWidth: 1.5,
    borderRadius: 999,
    paddingHorizontal: 12,
    minHeight: 48,
    justifyContent: 'center',
  },
  input: {
    minHeight: 48,
    maxHeight: 120,
    borderWidth: 2,
    borderRadius: 14,
    padding: 10,
    fontSize: 17,
  },
});
