import type { Theme } from './tokens';

/**
 * Header and scene colours for every navigator (root stack and tabs), from the tokens, so screens
 * pushed above the tabs follow dark mode too instead of the navigation library's light default.
 */
export const stackOptions = (c: Theme) => ({
  headerStyle: { backgroundColor: c.bg },
  headerTintColor: c.primary,
  headerTitleStyle: { color: c.fg },
  headerShadowVisible: false,
  contentStyle: { backgroundColor: c.bg },
});
