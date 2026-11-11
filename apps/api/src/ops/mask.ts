/** Masking for the ops app (AD-05): staff see enough to help, not the data itself. */

export const maskEmail = (e: string) => {
  const [local = '', domain = ''] = e.split('@');
  return `${local.slice(0, 1)}•••@${domain}`;
};

/** "+4915123456789" → "+49 ••• 6789" */
export const maskPhone = (e164: string) => `${e164.slice(0, 3)} ••• ${e164.slice(-4)}`;

/** "K-AB 1234" → "K-•• ••34": district and last two characters only. */
export const maskPlate = (plate: string) => {
  const [district = '', ...rest] = plate.split('-');
  const tail = rest.join('-');
  const keep = tail.replace(/\s/g, '').slice(-2);
  return `${district}-${tail.replace(/[A-Z0-9]/gi, '•').slice(0, -2)}${keep}`;
};

/** Shipping address → postcode prefix and country only. */
export const maskAddress = (json: string) => {
  try {
    const a = JSON.parse(json) as { postalCode?: string; country?: string };
    return `${(a.postalCode ?? '').slice(0, 2)}••• · ${a.country ?? ''}`;
  } catch {
    return '•••';
  }
};
