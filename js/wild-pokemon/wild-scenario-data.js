export const WILD_SOCIAL_SCENARIOS = [
  {
    id: 'flower_discovery',
    weight: 1.0,
    minMembers: 2,
    itemSlug: 'sun-stone',
    steps: [
      {
        // One pokemon finds a flower and exclamates
        actor: 'finder',
        delay: 0,
        bubble: [{ kind: 'text', text: '❗' }],
        emotion: 0, // Surprised
        duration: 5.0
      },
      {
        // Expressing how beautiful it is
        actor: 'finder',
        delay: 4.5,
        bubble: [
          { kind: 'item', slug: 'sun-stone' },
          { kind: 'text', text: '🤩✨' }
        ],
        emotion: 2, // Joyous
        duration: 8.0
      },
      {
        // Group gets attention - some "?" or "..."
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
        // A skeptic interjects to say it's not beautiful
        actor: 'skeptic', 
        delay: 14.0,
        bubble: [
          { kind: 'item', slug: 'sun-stone' },
          { kind: 'text', text: '💩' }
        ],
        emotion: 4, // Angry
        duration: 8.0
      },
      {
        // Founder insists
        actor: 'finder',
        delay: 23.0,
        bubble: [{ kind: 'text', text: '💢❗' }],
        emotion: 4,
        duration: 7.0
      },
      {
        // Conclusion
        actor: 'all',
        delay: 32.0,
        bubble: [{ kind: 'text', text: '💨' }],
        duration: 6.0
      }
    ]
  }
];
