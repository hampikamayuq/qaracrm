import { defineView, ViewType } from 'twenty-sdk/define';
import { CONVERSATION_OBJECT_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';

export const ALL_CONVERSATIONS_VIEW_UNIVERSAL_IDENTIFIER = 'ee1d8e51-2882-49f8-a08d-fa2d631e1053';

export default defineView({
  universalIdentifier: ALL_CONVERSATIONS_VIEW_UNIVERSAL_IDENTIFIER,
  name: 'All Conversations',
  objectUniversalIdentifier: CONVERSATION_OBJECT_UNIVERSAL_IDENTIFIER,
  type: ViewType.TABLE,
  icon: 'IconMessages',
  position: 0,
  fields: [
    {
      universalIdentifier: 'ca212ea2-5e4f-4fa0-92b5-8020288a1bd1',
      fieldMetadataUniversalIdentifier: '849bbc27-69dd-49ec-8a58-8c59f10a8de7',
      position: 0,
      isVisible: true,
      size: 200,
    },
    {
      universalIdentifier: '967dc791-47d2-4bcf-a512-84bc90626f18',
      fieldMetadataUniversalIdentifier: '2ee2b491-0e77-4839-90a8-3f9940358ea0',
      position: 1,
      isVisible: true,
      size: 120,
    },
    {
      universalIdentifier: '96f3c6fa-e65d-463c-9cc4-cac1ea4ed568',
      fieldMetadataUniversalIdentifier: '427a83cd-760f-4248-bf0f-1d912c04b480',
      position: 2,
      isVisible: true,
      size: 140,
    },
    {
      universalIdentifier: '33bbcc71-3a15-474b-a4ff-f7e410435ab6',
      fieldMetadataUniversalIdentifier: '1808ab49-df55-4f94-acdd-7b15332d501e',
      position: 3,
      isVisible: true,
      size: 120,
    },
    {
      universalIdentifier: 'c8e53aa5-1fc8-4fb9-bd40-75213513cda8',
      fieldMetadataUniversalIdentifier: 'a83668b0-f6c5-405e-952e-5d62683fedd3',
      position: 4,
      isVisible: true,
      size: 180,
    }
  ],
});
