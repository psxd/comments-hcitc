/* Small, consistent SVG flag graphics for catalog country codes. */
const paths = {
  RU: '<rect width="24" height="16" fill="#fff"/><rect y="5.33" width="24" height="5.34" fill="#2455a4"/><rect y="10.67" width="24" height="5.33" fill="#d52b1e"/>',
  FR: '<rect width="24" height="16" fill="#fff"/><rect width="8" height="16" fill="#002395"/><rect x="16" width="8" height="16" fill="#ed2939"/>',
  IT: '<rect width="24" height="16" fill="#fff"/><rect width="8" height="16" fill="#009246"/><rect x="16" width="8" height="16" fill="#ce2b37"/>',
  SE: '<rect width="24" height="16" fill="#006aa7"/><rect x="7" width="3" height="16" fill="#fecc00"/><rect y="6.5" width="24" height="3" fill="#fecc00"/>',
  DE: '<rect width="24" height="16" fill="#ffce00"/><rect width="24" height="5.33" fill="#111"/><rect y="5.33" width="24" height="5.34" fill="#dd0000"/>',
  JP: '<rect width="24" height="16" fill="#fff"/><circle cx="12" cy="8" r="4.2" fill="#bc002d"/>',
  IN: '<rect width="24" height="16" fill="#fff"/><rect width="24" height="5.33" fill="#ff9933"/><rect y="10.67" width="24" height="5.33" fill="#138808"/><circle cx="12" cy="8" r="2.4" fill="none" stroke="#000080" stroke-width=".75"/>',
  CN: '<rect width="24" height="16" fill="#de2910"/><path d="m5 2 .7 2.1h2.2L6.1 5.5l.7 2.1L5 6.3 3.2 7.6l.7-2.1L2.1 4.1h2.2z" fill="#ffde00"/>',
  GB: '<rect width="24" height="16" fill="#012169"/><path d="M0 0 24 16M24 0 0 16" stroke="#fff" stroke-width="4"/><path d="M0 0 24 16M24 0 0 16" stroke="#c8102e" stroke-width="1.7"/><path d="M12 0v16M0 8h24" stroke="#fff" stroke-width="5"/><path d="M12 0v16M0 8h24" stroke="#c8102e" stroke-width="2.6"/>',
  CA: '<rect width="24" height="16" fill="#fff"/><rect width="5" height="16" fill="#d80621"/><rect x="19" width="5" height="16" fill="#d80621"/><path d="m12 3 1 2 2-.5-.8 2 1.8 1-2 1 1 2-2-.3-1 2-1-2-2 .3 1-2-2-1 1.8-1-.8-2 2 .5z" fill="#d80621"/>',
  BR: '<rect width="24" height="16" fill="#009b3a"/><path d="M12 2 22 8 12 14 2 8z" fill="#ffdf00"/><circle cx="12" cy="8" r="3.2" fill="#002776"/>',
  IL: '<rect width="24" height="16" fill="#fff"/><path d="M0 3h24M0 13h24" stroke="#0038b8" stroke-width="1.5"/><path d="m12 5 3 5H9zM12 11 9 6h6z" fill="none" stroke="#0038b8" stroke-width=".7"/>',
  KR: '<rect width="24" height="16" fill="#fff"/><path d="M8 8a4 4 0 0 1 8 0c0 2.2-1.8 4-4 4s-4-1.8-4-4" fill="#cd2e3a"/><path d="M16 8a4 4 0 0 1-8 0c0-2.2 1.8-4 4-4s4 1.8 4 4" fill="#0047a0"/>',
  AU: '<rect width="24" height="16" fill="#012169"/><circle cx="18" cy="10" r="1.1" fill="#fff"/><circle cx="16" cy="4" r=".7" fill="#fff"/><path d="M0 0 11 8M11 0 0 8" stroke="#fff" stroke-width="1.6"/><path d="M5.5 0v8M0 4h11" stroke="#fff" stroke-width="2"/><path d="M5.5 0v8M0 4h11" stroke="#c8102e" stroke-width=".9"/>'
};
paths.US = '<rect width="24" height="16" fill="#fff"/>' + Array.from({length:7},(_,i)=>`<rect y="${(i*16/6.5).toFixed(2)}" width="24" height="1.23" fill="#b22234"/>`).join('') + '<rect width="10" height="8.7" fill="#3c3b6e"/>' + Array.from({length:4},(_,r)=>Array.from({length:5},(_,c)=>`<circle cx="${1+c*2}" cy="${1+r*2.1}" r=".28" fill="#fff"/>`).join('')).join('');

const ownerCodes = {US:['US'],USA:['US'],CIS:['RU'],RU:['RU'],RUS:['RU'],SWED:['SE'],SE:['SE'],PRC:['CN'],CN:['CN'],FR:['FR'],FRIT:['FR','IT'],IT:['IT'],GER:['DE'],DE:['DE'],JPN:['JP'],JP:['JP'],IND:['IN'],IN:['IN'],UK:['GB'],GB:['GB'],CAN:['CA'],BRAZ:['BR'],ISR:['IL'],KOR:['KR'],AUS:['AU']};
const names = {US:'United States',RU:'Russia',FR:'France',IT:'Italy',SE:'Sweden',DE:'Germany',JP:'Japan',IN:'India',CN:'China',GB:'United Kingdom',CA:'Canada',BR:'Brazil',IL:'Israel',KR:'South Korea',AU:'Australia'};

export function flagsForOwner(code) {
  return (ownerCodes[String(code || '').toUpperCase()] || []).map(iso => {
    const span = document.createElement('span'); span.className = 'flag-icon'; span.title = names[iso];
    span.setAttribute('role', 'img'); span.setAttribute('aria-label', `${names[iso]} flag`);
    span.innerHTML = `<svg viewBox="0 0 24 16" aria-hidden="true" focusable="false">${paths[iso]}</svg>`;
    return span;
  });
}

const emoji = {US:'🇺🇸',RU:'🇷🇺',FR:'🇫🇷',IT:'🇮🇹',SE:'🇸🇪',DE:'🇩🇪',JP:'🇯🇵',IN:'🇮🇳',CN:'🇨🇳',GB:'🇬🇧',CA:'🇨🇦',BR:'🇧🇷',IL:'🇮🇱',KR:'🇰🇷',AU:'🇦🇺'};
export function emojiForOwner(code) {
  return (ownerCodes[String(code || '').toUpperCase()] || []).map(iso => emoji[iso]);
}
