import { defineView, ViewType } from 'twenty-sdk/define';
import { LEAD_OBJECT_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';

export const ALL_LEADS_VIEW_UNIVERSAL_IDENTIFIER = '30ab0308-4d0e-415b-a2a8-6f418e7ab1ec';

export default defineView({
  universalIdentifier: ALL_LEADS_VIEW_UNIVERSAL_IDENTIFIER,
  name: 'All Leads',
  objectUniversalIdentifier: LEAD_OBJECT_UNIVERSAL_IDENTIFIER,
  type: ViewType.TABLE,
  icon: 'IconTargetArrow',
  position: 0,
  fields: [
    {
      universalIdentifier: '184bc32b-d72f-4039-81f0-908135c0b259',
      fieldMetadataUniversalIdentifier: '30c003fc-c4a1-47a5-844a-a2b8dc23c211',
      position: 0,
      isVisible: true,
      size: 210,
    },
    {
      universalIdentifier: '14077796-0c4f-4683-be82-35b99e16dae8',
      fieldMetadataUniversalIdentifier: '79cdcd74-5c2b-4c1f-bd10-bc41f6e28963',
      position: 1,
      isVisible: true,
      size: 180,
    },
    {
      universalIdentifier: '3e5ee9fb-2722-42e6-8104-26caed9307b6',
      fieldMetadataUniversalIdentifier: '612118cb-d499-4cdc-bde7-954cf3bc7ffd',
      position: 2,
      isVisible: true,
      size: 140,
    },
    {
      universalIdentifier: '21eac822-5204-472e-85c1-ae6195b46622',
      fieldMetadataUniversalIdentifier: 'a1a67bfa-8577-43de-a73f-4b1ebc1113fa',
      position: 3,
      isVisible: true,
      size: 100,
    },
    {
      universalIdentifier: 'de837bcd-0c79-45e3-b988-a525e4f87b0c',
      fieldMetadataUniversalIdentifier: 'ac1c10a3-d2c6-450f-bd19-755ab96f3adb',
      position: 4,
      isVisible: true,
      size: 140,
    },
    {
      universalIdentifier: '33ed1c48-b429-48d6-9401-46af5ba81cef',
      fieldMetadataUniversalIdentifier: '869dfe8e-aaff-43ea-a10a-fbbc28ff68eb',
      position: 5,
      isVisible: true,
      size: 200,
    }
  ],
});
