import { defineView, ViewType } from 'twenty-sdk/define';
import { PATIENT_OBJECT_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';

export const ALL_PATIENTS_VIEW_UNIVERSAL_IDENTIFIER = '63b2d195-531c-4bba-ba0c-7a8b84365281';

export default defineView({
  universalIdentifier: ALL_PATIENTS_VIEW_UNIVERSAL_IDENTIFIER,
  name: 'All Patients',
  objectUniversalIdentifier: PATIENT_OBJECT_UNIVERSAL_IDENTIFIER,
  type: ViewType.TABLE,
  icon: 'IconHeartbeat',
  position: 0,
  fields: [
    {
      universalIdentifier: 'b8dcf879-4dbb-4927-aca3-eefa706e99ad',
      fieldMetadataUniversalIdentifier: '18f2224b-73a9-4dab-a2c7-38b168c6c7db',
      position: 0,
      isVisible: true,
      size: 210,
    },
    {
      universalIdentifier: '87fe1296-d860-424e-88db-4ad3f36a92f9',
      fieldMetadataUniversalIdentifier: 'fa94810c-7aed-4097-ae84-79a4d9e4b71d',
      position: 1,
      isVisible: true,
      size: 180,
    },
    {
      universalIdentifier: 'a14b71fd-d58a-40cb-924c-330fd53f50d9',
      fieldMetadataUniversalIdentifier: '8cafd2f5-d178-42c1-b9f4-3724e9fa56da',
      position: 2,
      isVisible: true,
      size: 200,
    },
    {
      universalIdentifier: 'b0514403-be7d-4e9e-ab36-46aca067d2b8',
      fieldMetadataUniversalIdentifier: '5a792586-f2ff-436e-8887-afc0cc741ced',
      position: 3,
      isVisible: true,
      size: 200,
    }
  ],
});
