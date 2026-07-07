import { defineView, ViewType } from 'twenty-sdk/define';
import { PIPELINE_OBJECT_UNIVERSAL_IDENTIFIER, PIPELINE_VIEW_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';

export default defineView({
  universalIdentifier: PIPELINE_VIEW_UNIVERSAL_IDENTIFIER,
  name: 'All Pipelines',
  objectUniversalIdentifier: PIPELINE_OBJECT_UNIVERSAL_IDENTIFIER,
  type: ViewType.TABLE,
  icon: 'IconRoute',
  position: 0,
  fields: [
    {
      universalIdentifier: '3a4b5c6d-7e8f-9012-3456-789012345678',
      fieldMetadataUniversalIdentifier: '5e6f7a8b-9c0d-1234-ef56-789012345678',
      position: 0,
      isVisible: true,
      size: 200,
    },
    {
      universalIdentifier: '4b5c6d7e-8f9a-0123-4567-890123456789',
      fieldMetadataUniversalIdentifier: '6f7a8b9c-0d1e-2345-f678-901234567890',
      position: 1,
      isVisible: true,
      size: 180,
    },
    {
      universalIdentifier: '5c6d7e8f-9a0b-1234-5678-901234567890',
      fieldMetadataUniversalIdentifier: '7a8b9c0d-1e2f-3456-7890-123456789012',
      position: 2,
      isVisible: true,
      size: 80,
    },
  ],
});