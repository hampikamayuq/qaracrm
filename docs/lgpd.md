# LGPD Compliance - QARA CRM

## Legal Basis

QARA CRM stores lead, patient, appointment, and WhatsApp conversation data to support appointment scheduling, operational follow-up, and service delivery. The expected bases are consent for WhatsApp contact and contract or pre-contract execution for scheduling and service operations.

## Data Categories

- Lead contact data: name, phone, email, source, intent, tags, and score metadata.
- Patient contact data when a lead becomes a patient.
- Conversation data: inbound and outbound WhatsApp messages and AI suggestions.
- Appointment data: schedule, status, linked professional, linked service, and operational notes.

## Consent Record

The first-contact flow should record consent before ongoing processing. The current implementation records consent as an `Activity` entry through `recordConsent(conversationId, data)` with the body `lgpd.consent_recorded`.

The opt-out flow is implemented separately: when the patient sends an opt-out phrase such as `parar`, the system marks the lead as opted out and sends a confirmation without invoking Tawany.

## Retention

- Active conversations and appointments remain available for clinical operations.
- Leads without conversion should be reviewed for deletion or anonymization after inactivity.
- Database backups should be rotated, with the backup script keeping the last 30 dumps by default.

## Data Subject Rights

The API exposes admin-only routes for Article 18-style requests:

- `GET /api/lgpd/export?leadId=<id>` exports lead, conversations, messages, and AI suggestions.
- `POST /api/lgpd/anonymize` with `{ "leadId": "<id>" }` removes direct identifiers from lead, patient, messages, suggestions, and appointment notes.

Both routes require an authenticated admin session.

## Operational Notes

- LGPD actions log actor ID, lead ID, action, and aggregate counts only.
- Logs must not include message bodies, patient names, phone numbers, emails, or raw WhatsApp payloads.
- The anonymization endpoint preserves referential integrity while replacing direct PII with synthetic values.

## DPO

To be defined by the clinic.
