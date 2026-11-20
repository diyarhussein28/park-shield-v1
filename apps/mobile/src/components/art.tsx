import { View } from 'react-native';
import Svg, { Circle, G, Path, Rect } from 'react-native-svg';
import { useTheme, type Theme } from '@/theme/tokens';

/*
 * The app's illustrations (P13): one line weight (3), rounded joins, blue + the logo's yellow.
 * Always decorative: the text next to them carries the meaning, so they are hidden from VoiceOver.
 */

function Frame({
  width,
  height,
  viewBox,
  children,
  testID,
}: {
  width: number;
  height: number;
  viewBox: string;
  children: React.ReactNode;
  testID?: string;
}) {
  return (
    <View
      testID={testID}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ alignItems: 'center', justifyContent: 'center' }}
    >
      <Svg width={width} height={height} viewBox={viewBox}>
        {children}
      </Svg>
    </View>
  );
}

/** The decal: blue square, white QR finders, the yellow corner of the logo. */
function Decal({ x, y, size, c }: { x: number; y: number; size: number; c: Theme }) {
  const q = size / 4;
  return (
    <G>
      <Rect x={x} y={y} width={size} height={size} rx={size * 0.18} fill="#1d4ed8" />
      <Rect x={x + q * 0.6} y={y + q * 0.6} width={q} height={q} rx={1} fill="#ffffff" />
      <Rect x={x + q * 2.4} y={y + q * 0.6} width={q} height={q} rx={1} fill={c.accent} />
      <Rect x={x + q * 0.6} y={y + q * 2.4} width={q} height={q} rx={1} fill="#ffffff" />
      <Rect x={x + q * 2.5} y={y + q * 2.5} width={q * 0.5} height={q * 0.5} fill="#ffffff" />
    </G>
  );
}

/** A side view of a car with wheels and the decal low on the windscreen. */
function CarShape({
  c,
  x = 0,
  y = 0,
  scale = 1,
}: {
  c: Theme;
  x?: number;
  y?: number;
  scale?: number;
}) {
  return (
    <G transform={`translate(${x} ${y}) scale(${scale})`}>
      <Path d="M8 112h224" stroke={c.border} strokeWidth={3} strokeLinecap="round" />
      <Path
        d="M20 92V79c0-6 4-10 10-11l30-5 25-24c4-4 9-6 15-6h58c6 0 11 2 15 6l23 23 17 4c7 2 11 6 11 13v13Z"
        fill={c.primary}
      />
      <Path d="M70 64 90 45c2-2 5-3 8-3h4v22Z" fill={c.infoBg} />
      <Path d="M110 42h46c4 0 7 1 10 4l18 18h-74Z" fill={c.infoBg} />
      <Decal x={162} y={50} size={11} c={c} />
      <Rect x={211} y={71} width={10} height={6} rx={3} fill={c.accent} />
      <Rect x={20} y={72} width={7} height={6} rx={3} fill={c.urgent} />
      <Path
        d="M104 72h14"
        stroke={c.primaryFg}
        strokeWidth={3}
        strokeLinecap="round"
        opacity={0.7}
      />
      {[62, 180].map((cx) => (
        <G key={cx}>
          <Circle cx={cx} cy={94} r={17} fill={c.fg} />
          <Circle cx={cx} cy={94} r={7} fill={c.surface} />
        </G>
      ))}
    </G>
  );
}

export function CarArt({
  width = 240,
  protectedBadge,
}: {
  width?: number;
  protectedBadge?: boolean;
}) {
  const c = useTheme();
  return (
    <Frame testID="art-car" width={width} height={(width * 130) / 240} viewBox="0 0 240 130">
      <CarShape c={c} />
      {protectedBadge && (
        <G transform="translate(198 4)">
          <Circle cx={18} cy={18} r={18} fill={c.accent} />
          <Path
            d="M10 18.5l5.5 5.5L27 12.5"
            stroke={c.accentFg}
            strokeWidth={3.5}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </G>
      )}
    </Frame>
  );
}

/** Inside view of the windscreen: where the decal goes (low on the passenger side). */
export function WindscreenArt({ width = 220 }: { width?: number }) {
  const c = useTheme();
  return (
    <Frame testID="art-windscreen" width={width} height={(width * 130) / 220} viewBox="0 0 220 130">
      <Path
        d="M30 20h160l22 92H8Z"
        fill={c.infoBg}
        stroke={c.primary}
        strokeWidth={3}
        strokeLinejoin="round"
      />
      <Path d="M110 20v16" stroke={c.primary} strokeWidth={3} strokeLinecap="round" />
      <Rect x={98} y={34} width={24} height={9} rx={3} fill={c.primary} />
      <Decal x={140} y={78} size={26} c={c} />
      <Path
        d="M132 112c6-8 18-10 30-6"
        stroke={c.accent}
        strokeWidth={3}
        fill="none"
        strokeLinecap="round"
        strokeDasharray="1 7"
      />
    </Frame>
  );
}

/** The shield with a check: „protected“. */
export function ShieldArt({ size = 120, done = true }: { size?: number; done?: boolean }) {
  const c = useTheme();
  return (
    <Frame testID="art-shield" width={size} height={size} viewBox="0 0 120 120">
      <Circle cx={60} cy={60} r={56} fill={c.accentSubtle} />
      <Path d="M60 16 26 29v24c0 21 14 38 34 45 20-7 34-24 34-45V29Z" fill={c.primary} />
      {done ? (
        <Path
          d="M44 58l11 11 22-24"
          stroke={c.primaryFg}
          strokeWidth={7}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : (
        <Rect x={50} y={44} width={20} height={20} rx={4} fill={c.accent} />
      )}
    </Frame>
  );
}

function Phone({
  c,
  x,
  y,
  children,
}: {
  c: Theme;
  x: number;
  y: number;
  children?: React.ReactNode;
}) {
  return (
    <G transform={`translate(${x} ${y})`}>
      <Rect
        x={0}
        y={0}
        width={72}
        height={128}
        rx={14}
        fill={c.surface}
        stroke={c.fg}
        strokeWidth={3}
      />
      <Rect x={26} y={8} width={20} height={4} rx={2} fill={c.fg} />
      {children}
    </G>
  );
}

/** The three onboarding scenes: someone scans, you are told, you answer anonymously. */
export function OnboardingArt({ scene, width = 260 }: { scene: 1 | 2 | 3; width?: number }) {
  const c = useTheme();
  return (
    <Frame
      testID={`art-onboarding-${scene}`}
      width={width}
      height={(width * 180) / 260}
      viewBox="0 0 260 180"
    >
      <Circle cx={130} cy={92} r={84} fill={scene === 2 ? c.accentSubtle : c.infoBg} />
      {scene === 1 && (
        <G>
          <CarShape c={c} x={6} y={46} scale={0.82} />
          <Phone c={c} x={178} y={28}>
            <Decal x={16} y={36} size={40} c={c} />
            <Path
              d="M10 30v-8h8 M62 30v-8h-8 M10 86v8h8 M62 86v8h-8"
              stroke={c.primary}
              strokeWidth={3}
              fill="none"
              strokeLinecap="round"
            />
          </Phone>
        </G>
      )}
      {scene === 2 && (
        <G>
          <Phone c={c} x={94} y={26}>
            <Rect
              x={8}
              y={30}
              width={56}
              height={34}
              rx={8}
              fill={c.bg}
              stroke={c.primary}
              strokeWidth={2.5}
            />
            <Path d="M16 41h26 M16 51h38" stroke={c.fg} strokeWidth={3} strokeLinecap="round" />
            <Rect x={8} y={72} width={56} height={18} rx={9} fill={c.primary} />
          </Phone>
          <G transform="translate(164 18)">
            <Circle cx={18} cy={18} r={18} fill={c.accent} />
            <Path
              d="M11 15a7 7 0 0 1 14 0c0 6 3 8 3 8H8s3-2 3-8 M16 27a2 2 0 0 0 4 0"
              stroke={c.accentFg}
              strokeWidth={2.5}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </G>
        </G>
      )}
      {scene === 3 && (
        <G>
          <Path d="M92 40 62 52v22c0 19 13 34 30 40 17-6 30-21 30-40V52Z" fill={c.primary} />
          <Path
            d="M78 74l10 10 19-21"
            stroke={c.primaryFg}
            strokeWidth={6}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Rect x={136} y={54} width={96} height={36} rx={18} fill={c.accent} />
          <Path d="M152 72h64" stroke={c.accentFg} strokeWidth={4} strokeLinecap="round" />
          <Rect
            x={150}
            y={100}
            width={74}
            height={30}
            rx={15}
            fill={c.surface}
            stroke={c.border}
            strokeWidth={2}
          />
          <Path d="M164 115h46" stroke={c.muted} strokeWidth={3.5} strokeLinecap="round" />
        </G>
      )}
    </Frame>
  );
}
