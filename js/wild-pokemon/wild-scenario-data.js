export const WILD_SOCIAL_SCENARIOS = [
  /* ── 1. Flower Discovery (original) ───────────────────────────────── */
  {
    id: 'flower_discovery',
    weight: 1.0,
    minMembers: 2,
    itemSlug: 'sun-stone',
    steps: [
      {
        actor: 'finder',
        delay: 0,
        bubble: [{ kind: 'text', text: '❗' }],
        emotion: 0,
        duration: 5.0
      },
      {
        actor: 'finder',
        delay: 4.5,
        bubble: [
          { kind: 'item', slug: 'sun-stone' },
          { kind: 'text', text: '🤩✨' }
        ],
        emotion: 2,
        duration: 8.0
      },
      {
        actor: 'peers',
        delay: 6.0,
        bubbleByNature: {
          'Jolly': [{ kind: 'text', text: '❓✨' }],
          'Adamant': [{ kind: 'text', text: '...' }],
          'Timid': [{ kind: 'text', text: '❗' }],
          'default': [{ kind: 'text', text: '❓' }]
        },
        duration: 7.0
      },
      {
        actor: 'skeptic',
        delay: 14.0,
        bubble: [
          { kind: 'item', slug: 'sun-stone' },
          { kind: 'text', text: '💩' }
        ],
        emotion: 4,
        duration: 8.0
      },
      {
        actor: 'finder',
        delay: 23.0,
        bubble: [{ kind: 'text', text: '💢❗' }],
        emotion: 4,
        duration: 7.0
      },
      {
        actor: 'all',
        delay: 32.0,
        bubble: [{ kind: 'text', text: '💨' }],
        duration: 6.0
      }
    ]
  },

  /* ── 2. Territorial Dispute ───────────────────────────────────────── */
  {
    id: 'territorial_dispute',
    weight: 1.0,
    minMembers: 2,
    steps: [
      {
        // Finder stakes a claim on a spot
        actor: 'finder',
        delay: 0,
        bubble: [{ kind: 'text', text: '❗💪' }],
        emotion: 4, // Angry
        duration: 4.0
      },
      {
        // Skeptic challenges the claim
        actor: 'skeptic',
        delay: 3.5,
        bubble: [{ kind: 'text', text: '😤💢' }],
        emotion: 4,
        duration: 5.0
      },
      {
        // Peers react with concern
        actor: 'peers',
        delay: 6.0,
        bubbleByNature: {
          'Timid': [{ kind: 'text', text: '😨...' }],
          'Jolly': [{ kind: 'text', text: '👀❗' }],
          'default': [{ kind: 'text', text: '❓❓' }]
        },
        duration: 5.0
      },
      {
        // Finder growls louder
        actor: 'finder',
        delay: 10.0,
        bubble: [{ kind: 'text', text: '🔥💥' }],
        emotion: 4,
        duration: 5.0
      },
      {
        // Skeptic backs down
        actor: 'skeptic',
        delay: 15.0,
        bubble: [{ kind: 'text', text: '😓...' }],
        emotion: 7, // Sigh
        duration: 5.0
      },
      {
        // Finder claims victory
        actor: 'finder',
        delay: 20.0,
        bubble: [{ kind: 'text', text: '😤✊' }],
        emotion: 6, // Determined
        duration: 5.0
      },
      {
        // Everyone settles
        actor: 'all',
        delay: 26.0,
        bubble: [{ kind: 'text', text: '💨' }],
        duration: 5.0
      }
    ]
  },

  /* ── 3. Love Encounter ────────────────────────────────────────────── */
  {
    id: 'love_encounter',
    weight: 0.7,
    minMembers: 2,
    steps: [
      {
        // Finder notices someone special
        actor: 'finder',
        delay: 0,
        bubble: [{ kind: 'text', text: '❗' }],
        emotion: 0, // Surprised
        duration: 4.0
      },
      {
        // Hearts appear
        actor: 'finder',
        delay: 3.5,
        bubble: [{ kind: 'text', text: '💕💓' }],
        emotion: 3, // Happy
        duration: 6.0
      },
      {
        // Target reacts by nature
        actor: 'skeptic',
        delay: 7.0,
        bubbleByNature: {
          'Jolly': [{ kind: 'text', text: '💗✨' }],
          'Timid': [{ kind: 'text', text: '😳...' }],
          'Adamant': [{ kind: 'text', text: '...' }],
          'Bold': [{ kind: 'text', text: '💕❗' }],
          'default': [{ kind: 'text', text: '❓💭' }]
        },
        duration: 6.0
      },
      {
        // Peers react watching the scene
        actor: 'peers',
        delay: 10.0,
        bubbleByNature: {
          'Jolly': [{ kind: 'text', text: '😍✨' }],
          'Timid': [{ kind: 'text', text: '👀...' }],
          'default': [{ kind: 'text', text: '👀❓' }]
        },
        bubbleKind: 'think',
        duration: 5.0
      },
      {
        // Finder approaches with gift/affection
        actor: 'finder',
        delay: 15.0,
        bubble: [{ kind: 'text', text: '💝🌸✨' }],
        emotion: 2, // Joyous
        duration: 6.0
      },
      {
        // Response – acceptance
        actor: 'skeptic',
        delay: 21.0,
        bubble: [{ kind: 'text', text: '💗😊' }],
        emotion: 3, // Happy
        duration: 6.0
      },
      {
        // Group celebrates
        actor: 'all',
        delay: 27.0,
        bubble: [{ kind: 'text', text: '🎵💕' }],
        emotion: 2,
        duration: 5.0
      }
    ]
  },

  /* ── 4. Food Sharing ──────────────────────────────────────────────── */
  {
    id: 'food_sharing',
    weight: 1.2,
    minMembers: 2,
    itemSlug: 'oran-berry',
    steps: [
      {
        // Finder discovers food
        actor: 'finder',
        delay: 0,
        bubble: [{ kind: 'text', text: '❗' }],
        emotion: 0,
        duration: 4.0
      },
      {
        // Shows the food excitedly
        actor: 'finder',
        delay: 3.5,
        bubble: [
          { kind: 'item', slug: 'oran-berry' },
          { kind: 'text', text: '✨😋' }
        ],
        emotion: 2,
        duration: 6.0
      },
      {
        // Peers gather around
        actor: 'peers',
        delay: 6.0,
        bubbleByNature: {
          'Jolly': [{ kind: 'text', text: '😋❗' }],
          'Adamant': [{ kind: 'text', text: '🍎❓' }],
          'Timid': [{ kind: 'text', text: '...👀' }],
          'default': [{ kind: 'text', text: '❓✨' }]
        },
        duration: 6.0
      },
      {
        // Finder shares generously
        actor: 'finder',
        delay: 12.0,
        bubble: [
          { kind: 'item', slug: 'oran-berry' },
          { kind: 'text', text: '→😊' }
        ],
        emotion: 3,
        duration: 6.0
      },
      {
        // Everyone eats happily
        actor: 'all',
        delay: 18.0,
        bubble: [{ kind: 'text', text: '😋✨🎶' }],
        emotion: 2,
        duration: 6.0
      },
      {
        // Satisfied and sleepy
        actor: 'all',
        delay: 25.0,
        bubble: [{ kind: 'text', text: '😊💤' }],
        emotion: 3,
        duration: 6.0
      }
    ]
  },

  /* ── 5. Gossip About Player ───────────────────────────────────────── */
  {
    id: 'gossip_about_player',
    weight: 0.9,
    minMembers: 2,
    steps: [
      {
        // Finder spots the player's direction
        actor: 'finder',
        delay: 0,
        bubble: [{ kind: 'text', text: '❗👀' }],
        emotion: 0,
        duration: 4.0
      },
      {
        // Whispers to the group
        actor: 'finder',
        delay: 3.5,
        bubble: [{ kind: 'text', text: '🤫...' }],
        bubbleKind: 'think',
        duration: 5.0
      },
      {
        // Group all look in player's direction
        actor: 'peers',
        delay: 7.0,
        bubble: [{ kind: 'text', text: '👀❓' }],
        duration: 5.0
      },
      {
        // Nature-based reactions
        actor: 'all',
        delay: 12.0,
        bubbleByNature: {
          'Timid': [{ kind: 'text', text: '😨💦' }],
          'Bold': [{ kind: 'text', text: '😤💪' }],
          'Jolly': [{ kind: 'text', text: '😄❗' }],
          'Adamant': [{ kind: 'text', text: '🤔...' }],
          'default': [{ kind: 'text', text: '👀💭' }]
        },
        bubbleKind: 'think',
        duration: 6.0
      },
      {
        // Secret huddle
        actor: 'all',
        delay: 18.0,
        bubble: [{ kind: 'text', text: '🤫💬' }],
        bubbleKind: 'think',
        duration: 5.0
      },
      {
        // Resume
        actor: 'all',
        delay: 24.0,
        bubble: [{ kind: 'text', text: '💨' }],
        duration: 5.0
      }
    ]
  },

  /* ── 6. Group Play / Tag ──────────────────────────────────────────── */
  {
    id: 'group_play',
    weight: 1.1,
    minMembers: 2,
    steps: [
      {
        // One starts being playful
        actor: 'finder',
        delay: 0,
        bubble: [{ kind: 'text', text: '😄🎵' }],
        emotion: 2, // Joyous
        duration: 5.0
      },
      {
        // Invites group to play
        actor: 'finder',
        delay: 4.0,
        bubble: [{ kind: 'text', text: '😆❗✨' }],
        emotion: 2,
        duration: 5.0
      },
      {
        // Others join in
        actor: 'peers',
        delay: 7.0,
        bubbleByNature: {
          'Jolly': [{ kind: 'text', text: '😆✨❗' }],
          'Timid': [{ kind: 'text', text: '😊...' }],
          'Adamant': [{ kind: 'text', text: '...😤' }],
          'default': [{ kind: 'text', text: '😄❗' }]
        },
        emotion: 2,
        duration: 6.0
      },
      {
        // All playing together — chaotic fun
        actor: 'all',
        delay: 13.0,
        bubble: [{ kind: 'text', text: '🎵🎶✨' }],
        emotion: 2,
        duration: 7.0
      },
      {
        // Laughing
        actor: 'all',
        delay: 20.0,
        bubble: [{ kind: 'text', text: '😂🤣✨' }],
        emotion: 2,
        duration: 6.0
      },
      {
        // Tired but happy
        actor: 'all',
        delay: 27.0,
        bubble: [{ kind: 'text', text: '😊💤' }],
        emotion: 7, // Sigh (content)
        duration: 6.0
      }
    ]
  },

  /* ── 7. Lullaby / Rest ────────────────────────────────────────────── */
  {
    id: 'lullaby_rest',
    weight: 0.8,
    minMembers: 2,
    steps: [
      {
        // Leader starts humming
        actor: 'leader',
        delay: 0,
        bubble: [{ kind: 'text', text: '🎵~' }],
        emotion: 3, // Happy
        duration: 6.0
      },
      {
        // Continues melody
        actor: 'leader',
        delay: 5.0,
        bubble: [{ kind: 'text', text: '🎶✨~' }],
        emotion: 2, // Joyous
        duration: 7.0
      },
      {
        // Peers getting drowsy
        actor: 'peers',
        delay: 10.0,
        bubble: [{ kind: 'text', text: '😌...' }],
        emotion: 7, // Sigh
        duration: 6.0
      },
      {
        // Peers fall asleep
        actor: 'peers',
        delay: 16.0,
        bubble: [{ kind: 'text', text: '💤😴' }],
        emotion: 9, // Normal (sleeping)
        duration: 8.0
      },
      {
        // Leader finishes softly
        actor: 'leader',
        delay: 23.0,
        bubble: [{ kind: 'text', text: '🎵😊' }],
        emotion: 3,
        duration: 6.0
      },
      {
        // Everyone wakes up refreshed
        actor: 'all',
        delay: 30.0,
        bubble: [{ kind: 'text', text: '❗✨' }],
        emotion: 0, // Surprised
        duration: 5.0
      }
    ]
  }
];
