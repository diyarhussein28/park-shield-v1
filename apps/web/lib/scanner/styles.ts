// Inline CSS for the scanner page. Same AA-checked colour tokens as packages/ui/src/theme.css; every text
// colour pair below is ≥ 4.5:1 and every state border/icon ≥ 3:1 in both themes.
export const SCANNER_CSS = `
:root{--page:#f4f7fb;--card:#fff;--fg:#0f172a;--muted:#475569;--line:#e2e8f0;--strong:#64748b;
--primary:#1d4ed8;--primary-fg:#fff;--brand:#1d4ed8;--urgent:#b91c1c;--urg-bg:#fef2f2;--urg-ic:#fee2e2;--urg-line:#fca5a5;
--info-bg:#eff6ff;--info-fg:#1e3a8a;--bubble:#f1f5f9;--ok-bg:#f0fdf4;--ok-fg:#14532d;--warn-bg:#fffbeb;--warn-fg:#78350f;
--err-bg:#fef2f2;--err-fg:#7f1d1d;--grad:linear-gradient(135deg,#2563eb,#1e40af);--shadow:0 1px 3px rgba(15,23,42,.08);color-scheme:light}
@media (prefers-color-scheme:dark){:root{--page:#0b1220;--card:#111a2e;--fg:#f1f5f9;--muted:#94a3b8;--line:#334155;--strong:#94a3b8;
--primary:#60a5fa;--primary-fg:#0b1220;--brand:#93c5fd;--urgent:#f87171;--urg-bg:#2a1418;--urg-ic:#450a0a;--urg-line:#7f1d1d;
--info-bg:#172554;--info-fg:#dbeafe;--bubble:#1e293b;--ok-bg:#052e16;--ok-fg:#dcfce7;--warn-bg:#451a03;--warn-fg:#fef3c7;
--err-bg:#450a0a;--err-fg:#fee2e2;--grad:linear-gradient(135deg,#1d4ed8,#1e3a8a);--shadow:none;color-scheme:dark}}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--page);color:var(--fg);font:17px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif}
.wrap{max-width:34rem;margin:0 auto;padding:0 16px 28px}
svg{width:24px;height:24px;flex:none;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
svg .acc{fill:#facc15;stroke:none}
.top{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:12px 0}
.brand{display:flex;align-items:center;gap:8px;font-weight:800;font-size:20px;color:var(--brand)}
.logo{width:32px;height:32px;stroke:none}
.langs{display:flex}
button{font:inherit;cursor:pointer;border-radius:14px;border:0}
:focus-visible{outline:3px solid var(--primary);outline-offset:2px}
.lang{min-width:52px;min-height:48px;padding:0 10px;font-weight:700;background:var(--card);color:var(--fg);border:1.5px solid var(--strong)}
.lang:first-child{border-radius:12px 0 0 12px}.lang:last-child{border-radius:0 12px 12px 0;margin-left:-1.5px}
.lang[aria-pressed=true]{background:var(--primary);color:var(--primary-fg);border-color:var(--primary);position:relative}
h1{font-size:28px;line-height:1.2;margin:8px 0 6px}h2{font-size:21px;line-height:1.3;margin:0 0 12px}h3{font-size:18px;margin:0 0 10px}
p{margin:0 0 12px}.muted{color:var(--muted)}
.card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:16px;margin:12px 0;box-shadow:var(--shadow)}
.vehicle{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;padding:10px 14px;border-radius:14px;background:var(--card);border:1px solid var(--line);margin:12px 0;color:var(--primary)}
.vehicle b{font-size:18px;color:var(--fg)}
.note{padding:12px 14px;border-radius:14px;margin:12px 0}
.inote{display:flex;gap:10px;align-items:flex-start}.inote svg{margin-top:1px}
.info{background:var(--info-bg);color:var(--info-fg)}.ok{background:var(--ok-bg);color:var(--ok-fg)}
.warn{background:var(--warn-bg);color:var(--warn-fg)}.err{background:var(--err-bg);color:var(--err-fg)}
.closed{background:var(--bubble);color:var(--fg);border:1px solid var(--line);font-weight:600}
label{display:block;font-weight:700;margin:12px 0 6px}label.small{font-size:15px;margin:16px 0 6px}
input,textarea{display:block;width:100%;font:inherit;color:var(--fg);background:var(--card);border:1.5px solid var(--strong);border-radius:14px}
input{min-height:52px;padding:0 14px}textarea{min-height:120px;padding:12px}
::placeholder{color:var(--muted);opacity:1}
.field{position:relative}.field svg{position:absolute;left:14px;top:14px;color:var(--muted);pointer-events:none}.field input{padding-left:48px}
.types{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:16px 0 12px}
.type{position:relative;min-height:112px;padding:14px 8px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;text-align:center;font-weight:700;font-size:16px;line-height:1.25;background:var(--card);color:var(--fg);border:2px solid var(--line);border-radius:16px;box-shadow:var(--shadow);overflow-wrap:anywhere}
.type .ic{width:44px;height:44px;border-radius:50%;display:grid;place-items:center;background:var(--info-bg);color:var(--primary)}
.type.urgent{background:var(--urg-bg);border-color:var(--urg-line)}.type.urgent .ic{background:var(--urg-ic);color:var(--urgent)}
.type[aria-pressed=true]{border-color:var(--primary)}.type.urgent[aria-pressed=true]{border-color:var(--urgent)}
.chk{position:absolute;top:8px;right:8px;width:26px;height:26px;border-radius:50%;background:var(--primary);color:var(--primary-fg);display:none;place-items:center}
.chk svg{width:16px;height:16px;stroke-width:3}.urgent .chk{background:var(--urgent)}.type[aria-pressed=true] .chk{display:grid}
.custom{width:100%;display:flex;align-items:center;gap:14px;min-height:84px;padding:14px 16px;border-radius:16px;background:var(--grad);color:#fff;text-align:left}
.custom .bubble{width:52px;height:52px;flex:none;border-radius:14px;background:rgba(255,255,255,.16);display:grid;place-items:center}
.custom b{display:block;font-size:18px}.custom small{display:block;font-size:15px}
.grow{flex:1;min-width:0}
.primary{min-height:56px;width:100%;padding:0 16px;font-weight:700;background:var(--primary);color:var(--primary-fg);display:flex;align-items:center;justify-content:center;gap:10px;margin:8px 0}
a.primary{text-decoration:none;border-radius:14px}
.big{font-size:18px;margin-top:16px}
.secondary{min-height:52px;width:100%;padding:0 16px;font-weight:700;background:var(--card);color:var(--primary);border:1.5px solid var(--primary);display:flex;align-items:center;justify-content:center;gap:8px;margin:8px 0}
.row{width:100%;min-height:56px;display:flex;align-items:center;gap:12px;padding:12px 14px;margin:12px 0;background:var(--card);color:var(--fg);border:1px solid var(--line);border-radius:16px;text-align:left;font-weight:600;box-shadow:var(--shadow)}
.row>svg:first-child{color:var(--primary)}.row>svg:last-child{color:var(--muted)}
.danger{display:flex;gap:12px;align-items:center;padding:12px 14px;margin:12px 0;border-radius:16px;background:var(--err-bg);color:var(--err-fg);border:1px solid var(--urg-line);font-weight:600}
.danger svg{color:var(--urgent)}
.hint{font-size:15px;color:var(--muted);margin:6px 0 12px}
.h-ic{display:flex;align-items:center;gap:8px;margin:20px 0 4px;font-size:19px}.h-ic svg{color:var(--primary)}
.steps{list-style:none;padding:0;margin:4px 0 12px;display:grid;grid-template-columns:repeat(3,1fr);text-align:center}
.steps li{position:relative;display:flex;flex-direction:column;align-items:center;gap:6px;font-size:15px;color:var(--muted);min-width:0;overflow-wrap:anywhere}
.steps li+li::before{content:"";position:absolute;top:14px;right:50%;width:100%;height:2px;background:var(--strong)}
.dot{position:relative;z-index:1;width:30px;height:30px;border-radius:50%;border:2px solid var(--strong);background:var(--card);display:grid;place-items:center}
.dot svg{width:16px;height:16px;stroke-width:3;visibility:hidden}
.steps li.done{color:var(--fg);font-weight:700}.steps li.done::before{background:var(--primary)}
.steps li.done .dot{background:var(--primary);border-color:var(--primary);color:var(--primary-fg)}.steps li.done .dot svg{visibility:visible}
.note h3{font-size:18px;margin:0 0 8px}.note p:last-child{margin:0}.note a{color:inherit;font-weight:700}
.linkbtn{min-height:48px;padding:0;background:none;color:var(--primary);text-decoration:underline;font-size:15px}
footer{margin-top:24px;padding-top:16px;border-top:1px solid var(--line);font-size:15px;color:var(--muted)}
footer p{margin:0 0 10px}footer a{color:var(--primary);font-weight:600}
footer a svg{width:16px;height:16px;vertical-align:-3px}
.trust{display:flex;gap:10px;align-items:flex-start}.trust svg{color:var(--primary)}.trust b{color:var(--fg)}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.slots{list-style:none;padding:0;margin:8px 0;display:grid;grid-template-columns:1fr 1fr;gap:10px}
.slots li{display:grid;gap:6px;min-width:0}.slots img{width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:12px;border:1px solid var(--line)}
.slots .secondary{min-height:48px;margin:0;font-size:15px;padding:0 8px}
.slot{width:100%;min-height:112px;padding:8px;border:2px dashed var(--strong);background:var(--card);color:var(--primary);font-weight:700;font-size:15px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px}
.plus{font-size:28px;line-height:1}
#ph-cam{margin:12px 0;padding:12px;border-radius:14px;background:var(--card);border:2px solid var(--strong)}
#ph-cam h3{font-size:18px;margin:0 0 8px}#ph-video{display:block;width:100%;max-height:60vh;border-radius:12px;background:#000;margin-bottom:10px}
button:disabled{opacity:.6;cursor:not-allowed}
.sys{background:var(--info-bg);color:var(--info-fg);padding:10px 14px;border-radius:14px;margin:0 0 12px}
.chat{list-style:none;padding:0;margin:0 0 8px;display:grid;gap:12px;max-height:50vh;overflow-y:auto}
.chat li{display:flex;gap:8px;max-width:88%;min-width:0}
.chat li.owner{justify-self:start}.chat li.owner>div{min-width:0}
.chat li.scanner{justify-self:end;flex-direction:column;align-items:flex-end;gap:2px}
.bub{margin:0;padding:10px 14px;border-radius:16px;white-space:pre-wrap;overflow-wrap:anywhere}
.owner .bub{background:var(--bubble);color:var(--fg);border-top-left-radius:4px}
.scanner .bub{background:var(--primary);color:var(--primary-fg);border-bottom-right-radius:4px}
.chat small{display:block;font-size:13px;color:var(--muted);margin-bottom:2px}
.av{width:34px;height:34px;flex:none;border-radius:50%;background:var(--info-bg);color:var(--primary);display:grid;place-items:center}
.av svg{width:20px;height:20px}
.chatin{display:flex;gap:8px;align-items:center;margin-top:8px}
.chatin input{flex:1;min-width:0;border-radius:999px;padding:0 18px}
.round{width:52px;height:52px;flex:none;border-radius:50%;background:var(--primary);color:var(--primary-fg);display:grid;place-items:center}
[hidden]{display:none!important}
@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important;scroll-behavior:auto!important}}
`;
