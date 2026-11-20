import {
  CTA_MAX,
  CTA_SUGGESTIONS,
  DECAL_PRODUCTS,
  DECAL_TEMPLATES,
  type DecalProduct,
  type DecalTemplate,
} from '@parkshield/shared/alert-types';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Field, H3, Segmented } from '@/components/form';
import { Banner, Button, Loading, P, Screen } from '@/components/ui';
import { api, ApiError, authHeaders } from '@/lib/api';
import { API_URL } from '@/lib/config';
import { t } from '@/lib/i18n';
import { errorText, type PortalVehicle } from '@/lib/portal';
import { pt, type MessageKey } from '@/lib/portal-i18n';
import { radius, space, type as typeScale, useTheme } from '@/theme/tokens';

const CUSTOM = '__custom__';
const svg = (id: string, q: Record<string, string>) =>
  `${API_URL}/v1/vehicles/${id}/decal.svg?${new URLSearchParams(q)}`;

/**
 * The decal design on its own screen (P10, OW-03): the templates as real mini renders, the headline
 * as chips (or your own words), one live preview, and save.
 */
export default function DecalDesign() {
  const c = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [v, setV] = useState<PortalVehicle | null>(null);
  const [headers, setHeaders] = useState<Record<string, string> | null>(null);
  const [template, setTemplate] = useState<DecalTemplate>('classic' as DecalTemplate);
  const [choice, setChoice] = useState<string>(CTA_SUGGESTIONS[0]!);
  const [custom, setCustom] = useState('');
  const [product, setProduct] = useState<DecalProduct>('uv_vinyl_sticker');
  const [previewCta, setPreviewCta] = useState('');
  const [broken, setBroken] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void authHeaders().then(setHeaders);
    void api<PortalVehicle>(`/v1/vehicles/${id}`)
      .then((vehicle) => {
        setV(vehicle);
        const d = vehicle.decal;
        if (!d) return;
        setTemplate(d.template);
        const suggested = (CTA_SUGGESTIONS as readonly string[]).includes(d.cta);
        setChoice(suggested ? d.cta : CUSTOM);
        setCustom(suggested ? '' : d.cta);
        setPreviewCta(d.cta);
      })
      .catch((err) => setMessage({ tone: 'err', text: errorText(err) }));
  }, [id]);

  const cta = choice === CUSTOM ? custom.trim() : choice;
  // Debounce typing so the preview is not re-rendered on every key stroke.
  useEffect(() => {
    const timer = setTimeout(() => setPreviewCta(cta), 350);
    return () => clearTimeout(timer);
  }, [cta]);

  if (!v || !headers)
    return message ? (
      <Screen>
        <Banner tone="err">{message.text}</Banner>
      </Screen>
    ) : (
      <Loading />
    );

  const src = svg(v.id, { template, product, ...(previewCta ? { cta: previewCta } : {}) });

  const save = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await api<PortalVehicle>(`/v1/vehicles/${v.id}/decal`, {
        method: 'PUT',
        body: { template, cta },
      });
      router.back();
    } catch (err) {
      const blocked = err instanceof ApiError && err.body?.error === 'cta_not_allowed';
      setMessage({ tone: 'err', text: blocked ? pt('decal.ctaNotAllowed') : errorText(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <P muted>{pt('portal.designIntro')}</P>
      <View testID="design-preview" style={[s.preview, { borderColor: c.border }]}>
        {broken === src ? (
          <Banner tone="err">{pt('decal.ctaNotAllowed')}</Banner>
        ) : (
          <Image
            source={{ uri: src, headers }}
            contentFit="contain"
            style={product === 'uv_vinyl_sticker' ? s.square : s.card}
            onError={() => setBroken(src)}
            accessibilityLabel={pt('decal.previewAlt', { cta: previewCta })}
          />
        )}
      </View>

      <H3>{t('designTemplates')}</H3>
      <View
        style={s.thumbs}
        accessibilityRole="radiogroup"
        accessibilityLabel={t('designTemplates')}
      >
        {DECAL_TEMPLATES.map((tpl) => {
          const on = tpl === template;
          const label = pt(`decal.template_${tpl}` as MessageKey);
          return (
            <Pressable
              key={tpl}
              testID={`template-${tpl}`}
              accessibilityRole="radio"
              accessibilityLabel={label}
              accessibilityState={{ checked: on }}
              onPress={() => setTemplate(tpl)}
              style={[s.thumb, { borderColor: on ? c.primary : c.border, borderWidth: on ? 3 : 1 }]}
            >
              <View style={s.thumbImageBox}>
                <Image
                  source={{
                    uri: svg(v.id, { template: tpl, ...(previewCta ? { cta: previewCta } : {}) }),
                    headers,
                  }}
                  contentFit="contain"
                  style={s.thumbImage}
                  accessible={false}
                />
              </View>
              <Text
                numberOfLines={1}
                style={[
                  typeScale.caption,
                  { color: on ? c.primary : c.fg, fontWeight: on ? '800' : '600' },
                ]}
              >
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <H3>{t('designHeadline')}</H3>
      <View style={s.chips} accessibilityRole="radiogroup" accessibilityLabel={t('designHeadline')}>
        {[...CTA_SUGGESTIONS, CUSTOM].map((o) => {
          const on = o === choice;
          const label = o === CUSTOM ? pt('decal.ctaCustom') : o;
          return (
            <Pressable
              key={o}
              accessibilityRole="radio"
              accessibilityLabel={label}
              accessibilityState={{ checked: on }}
              onPress={() => setChoice(o)}
              style={[
                s.chip,
                {
                  backgroundColor: on ? c.primary : c.surface,
                  borderColor: on ? c.primary : c.borderStrong,
                },
              ]}
            >
              <Text style={[typeScale.label, { color: on ? c.primaryFg : c.fg }]}>{label}</Text>
            </Pressable>
          );
        })}
      </View>
      {choice === CUSTOM && (
        <Field
          label={pt('decal.ctaCustomLabel')}
          value={custom}
          onChangeText={setCustom}
          maxLength={CTA_MAX}
        />
      )}
      <Segmented
        legend={pt('decal.product')}
        options={DECAL_PRODUCTS}
        value={product}
        onChange={setProduct}
        label={(o) => pt(`decal.product_${o}` as MessageKey)}
      />
      {message && <Banner tone={message.tone}>{message.text}</Banner>}
      <Button
        label={pt('decal.save')}
        onPress={() => void save()}
        busy={busy}
        disabled={!cta}
        testID="design-save"
      />
    </Screen>
  );
}

const s = StyleSheet.create({
  preview: {
    borderWidth: 1,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#ffffff',
    padding: 8,
    alignItems: 'center',
  },
  square: { width: '100%', aspectRatio: 1, maxWidth: 360 },
  card: { width: '100%', aspectRatio: 105 / 148, maxWidth: 300 },
  thumbs: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  thumb: {
    flexBasis: '30%',
    flexGrow: 1,
    borderRadius: radius.md,
    padding: 6,
    gap: 4,
    alignItems: 'center',
    minHeight: 44,
  },
  thumbImageBox: {
    width: '100%',
    aspectRatio: 1,
    backgroundColor: '#ffffff',
    borderRadius: 8,
    overflow: 'hidden',
  },
  thumbImage: { width: '100%', height: '100%' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: {
    minHeight: 44,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    paddingHorizontal: 14,
    justifyContent: 'center',
  },
});
