import { COMPANY } from '@parkshield/shared';
import { z } from 'zod';

const text = (max: number) => z.string().trim().max(max);

/**
 * Company data and letter texts printed on customer letters (ops → Einstellungen → Unternehmen).
 * Every field is configurable; the defaults are the registered business from the Impressum.
 * Placeholders in texts: {name} (customer name), {plan} („ParkShield“), {portalUrl}.
 */
export const CompanyData = z.object({
  name: text(120).min(2),
  legalForm: text(60),
  street: text(100).min(3),
  postalCode: text(10).min(4),
  city: text(60).min(2),
  country: z.string().length(2),
  phone: text(40),
  email: z.email().max(254),
  website: text(100),
  vatId: text(20),
  taxNumber: text(30),
  owner: text(80),
  registerCourt: text(80),
  registerNumber: text(40),
  bankName: text(80),
  iban: text(40),
  bic: text(15),
  brandColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  signatureName: text(80),
  /**
   * TODO [LEGAL REVIEW]: which details a business letter must carry depends on the legal form
   * (§ 37a HGB for registered merchants, § 35a GmbHG, …). Each footer group can be switched off.
   */
  footer: z.object({
    vatId: z.boolean(),
    taxNumber: z.boolean(),
    owner: z.boolean(),
    register: z.boolean(),
    bank: z.boolean(),
  }),
  texts: z.object({
    greeting: text(120).min(2),
    welcome: text(1200).min(10),
    /**
     * Unused since the redesign of 2026-11-28 (the four steps are fixed in `letter.ts`, they describe
     * the app); kept optional so stored versions still parse.
     */
    nextSteps: text(1200).optional(),
    closing: text(80).min(2),
  }),
});
export type CompanyData = z.infer<typeof CompanyData>;

export const DEFAULT_COMPANY: CompanyData = {
  name: COMPANY.name,
  legalForm: COMPANY.legalForm,
  street: COMPANY.street,
  postalCode: COMPANY.postalCode,
  city: COMPANY.city,
  country: COMPANY.country,
  phone: COMPANY.phone,
  email: COMPANY.email,
  website: COMPANY.website,
  vatId: COMPANY.vatId,
  taxNumber: '',
  owner: COMPANY.owner,
  registerCourt: '',
  registerNumber: '',
  bankName: '',
  iban: '',
  bic: '',
  brandColor: '#1d4ed8',
  signatureName: COMPANY.owner,
  footer: { vatId: true, taxNumber: false, owner: true, register: false, bank: false },
  texts: {
    // No salutation (Herr/Frau) is stored, so the neutral form is the default.
    greeting: 'Guten Tag {name},',
    welcome:
      'herzlich willkommen bei ParkShield und vielen Dank für Ihr Vertrauen. Ihr ParkShield ist aktiv: Wer ein Problem an Ihrem geparkten Fahrzeug bemerkt, erreicht Sie ab sofort über den Aufkleber (QR-Code oder NFC), ohne Ihre Telefonnummer, Ihren Namen oder Ihr Kennzeichen zu sehen.',
    closing: 'Mit freundlichen Grüßen',
  },
};

/** Replaces {key} placeholders; an empty {name} also drops the space before it ("Guten Tag,"). */
export function fill(template: string, values: Record<string, string>): string {
  return template.replace(/( ?)\{(\w+)\}/g, (_, space: string, key: string) => {
    const v = values[key];
    if (v === undefined) return `${space}{${key}}`;
    return v ? `${space}${v}` : '';
  });
}
