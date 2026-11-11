// Inline CSS for the scanner page. Same AA-checked colour tokens as packages/ui/src/theme.css.
export const SCANNER_CSS = `
:root{--bg:#fff;--fg:#0f172a;--muted:#475569;--surface:#f8fafc;--border:#cbd5e1;--strong:#64748b;
--primary:#1d4ed8;--primary-fg:#fff;--urgent:#b91c1c;--info-bg:#eff6ff;--info-fg:#1e3a8a;
--ok-bg:#f0fdf4;--ok-fg:#14532d;--warn-bg:#fffbeb;--warn-fg:#78350f;--err-bg:#fef2f2;--err-fg:#7f1d1d;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--bg:#0b1220;--fg:#f1f5f9;--muted:#94a3b8;--surface:#111a2e;--border:#1e293b;
--strong:#64748b;--primary:#60a5fa;--primary-fg:#0b1220;--urgent:#f87171;--info-bg:#172554;--info-fg:#dbeafe;
--ok-bg:#052e16;--ok-fg:#dcfce7;--warn-bg:#451a03;--warn-fg:#fef3c7;--err-bg:#450a0a;--err-fg:#fee2e2;color-scheme:dark}}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--fg);font:18px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif}
main{max-width:34rem;margin:0 auto;padding:12px 16px 32px}
.top{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px}
.brand{font-weight:800;font-size:20px}
.langs{display:flex;gap:4px}
button{font:inherit;cursor:pointer;border-radius:14px;border:0}
:focus-visible{outline:3px solid var(--primary);outline-offset:2px}
.lang{min-width:48px;min-height:48px;padding:0 10px;font-weight:700;background:var(--surface);color:var(--fg);border:2px solid var(--border)}
.lang[aria-pressed=true]{background:var(--primary);color:var(--primary-fg);border-color:var(--primary)}
h1{font-size:28px;line-height:1.2;margin:8px 0 4px}h2{font-size:22px;margin:0 0 12px}
p{margin:0 0 12px}.muted{color:var(--muted)}
.vehicle{display:flex;align-items:center;gap:10px;padding:12px 14px;border-radius:14px;background:var(--surface);border:1px solid var(--border);margin:12px 0}
.vehicle b{font-size:20px}
.note{padding:12px 14px;border-radius:14px;margin:12px 0}
.info{background:var(--info-bg);color:var(--info-fg)}.ok{background:var(--ok-bg);color:var(--ok-fg)}
.warn{background:var(--warn-bg);color:var(--warn-fg)}.err{background:var(--err-bg);color:var(--err-fg)}
.types{display:grid;gap:10px;margin:16px 0}
.type{min-height:64px;width:100%;padding:12px 16px;text-align:left;font-weight:700;font-size:19px;background:var(--surface);color:var(--fg);border:2px solid var(--strong)}
.type.urgent{border-color:var(--urgent);border-left-width:8px}
.type:disabled{opacity:.6;cursor:wait}
.primary{min-height:56px;width:100%;padding:0 16px;font-weight:700;background:var(--primary);color:var(--primary-fg)}
a.primary{display:flex;align-items:center;justify-content:center;text-decoration:none;border-radius:14px}
.secondary{min-height:48px;width:100%;padding:0 16px;font-weight:600;background:transparent;color:var(--primary);text-decoration:underline}
label{display:block;font-weight:700;margin:12px 0 6px}
textarea{display:block;width:100%;min-height:120px;padding:12px;font:inherit;color:var(--fg);background:var(--bg);border:2px solid var(--strong);border-radius:14px}
.hint{font-size:15px;color:var(--muted);margin:6px 0 12px}
.steps{list-style:none;padding:0;margin:0 0 16px;display:grid;gap:8px}
.steps li{display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:12px;border:2px solid var(--border);color:var(--muted)}
.steps li::before{content:"";width:14px;height:14px;border-radius:50%;border:2px solid currentColor;flex:none}
.steps li.done{color:var(--fg);border-color:var(--primary)}.steps li.done::before{background:var(--primary);border-color:var(--primary)}
.steps li.final.done{border-color:var(--ok-fg)}
.note h3{font-size:18px;margin:0 0 8px}.note p:last-child{margin:0}.note a{color:inherit;font-weight:700}
.linkbtn{min-height:48px;padding:0;background:none;color:var(--primary);text-decoration:underline;font-size:15px}
footer{margin-top:28px;padding-top:16px;border-top:1px solid var(--border);font-size:15px;color:var(--muted)}
footer p{margin:0 0 6px}footer a{color:var(--primary)}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
[hidden]{display:none!important}
@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}
`;
