import { defineView, ViewType } from 'twenty-sdk/define';
import { PIPELINE_STAGE_OBJECT_UNIVERSAL_IDENTIFIER, PIPELINE_STAGE_VIEW_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';

export default defineView({
  universalIdentifier: PIPELINE_STAGE_VIEW_UNIVERSAL_IDENTIFIER,
  name: 'All Pipeline Stages',
  objectUniversalIdentifier: PIPELINE_STAGE_OBJECT_UNIVERSAL_IDENTIFIER,
  type: ViewType.TABLE,
  icon: 'IconLayoutKanban',
  position: 0,
  fields: [
    {
      universalIdentifier: '9c0d1e2f-3a4b-5678-9012-345678901234',
      fieldMetadataUniversalIdentifier: '1a2b3c4d-5e6f-7890-abcd-ef1234567890',
      position: 0,
      isVisible: true,
      size: 200,
    },
    {
      universalIdentifier: '0d1e2f3a-4b5c-6789-0123-456789012345',
      fieldMetadataUniversalIdentifier: '2b3c4d5e-6f7a-8901-bcde-f23456789012',
      position: 1,
      isVisible: true,
      size: 80,
    },
    {
      universalIdentifier: '1e2f3a4b-5c6d-7890-1234-567890123456',
      fieldMetadataUniversalIdentifier: '3c4d5e6f-7a8b-9012-cdef-345678901234',
      position: 2,
      isVisible: true,
      size: 180,
    },
    {
      universalIdentifier: '2f3a4b5c-6d7e-8901-2345-678901234567',
      fieldMetadataUniversalIdentifier: '4d5e6f7a-8b9c-0123-def4-567890123456',
      position: 3,
      isVisible: true,
      size: 100,
    },
  ],
});