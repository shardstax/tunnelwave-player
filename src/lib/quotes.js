// Quote lines, curated from public quote and compliment collections
// (quotlr.com, everydaypower.com, nomadisbeautiful.com, yahoo.com, selfsaid.pages.dev,
// betterhelp.com, cnbc.com, bodi.com). Authors intentionally left out.

// 50 little check-ins and compliments for whoever is listening
const NOTES = [
  'Hey, you are doing good. Keep it up!',
  'Hey! You look good today. Keep that smile on.',
  'You are doing better than you think.',
  'I’m so proud of you!',
  'You can do this.',
  'You are making a difference.',
  'You inspire me.',
  'You really light up a room.',
  'Your laugh is contagious.',
  'You have a gift for this.',
  'You are so talented!',
  'You handled that situation so well.',
  'I really admire your confidence.',
  'That color looks so good on you.',
  'You look like a movie star!',
  'You always work so hard.',
  'You have great energy and a positive vibe people love being around.',
  'I admire how strong you are, inside and out.',
  'Your creativity makes life more interesting.',
  'Keep making the boss moves!',
  'You never give up and always go after your dreams.',
  'You’re fearless and amazing when it comes to taking on a challenge.',
  'Anyone who knows you feels lucky to have you in their life.',
  'You notice the details most people miss.',
  'You spark kindness in others.',
  'You make the heavy lifts look easy.',
  'I’m so impressed with your dedication.',
  'You’ve worked so hard and you deserve this success.',
  'You always show up, and that means everything.',
  'The way you go after your goals really inspires me.',
  'You’re one of the most authentic and genuine people I know.',
  'You are so smart.',
  'You are so funny!',
  'I am grateful for you.',
  'You’re already on your way.',
  'Trying matters.',
  'Small steps still move you forward.',
  'There is no race. You are not behind.',
  'Your pace is perfect for where you are.',
  'You’ve made it through every hard day so far.',
  'Tired? Rest, don’t quit.',
  'Make your own sunshine.',
  'Joy will find you again. Let yourself stay open to it.',
  'Begin again. As many times as you need to.',
  'Celebrate the little wins. Keep showing up for yourself in small, steady ways.',
  'Your effort, no matter how invisible it seems, is a sign of strength.',
  'You’re starting to see yourself clearly, and that’s something to be proud of.',
  'Let yourself rest. You are allowed to pause.',
  'Self care isn’t selfish.',
  'Every tiny act of kindness toward yourself matters.',
];

// 50 quotes on life and dreams
const QUOTES = [
  'One life. Just one. Why aren’t we running like we are on fire towards our wildest dreams?',
  'The goal should be to die with memories, not dreams.',
  'Life is short. Time is fast. No replay. No rewind. So enjoy every moment as it comes.',
  'You only live once, but if you do it right, once is enough.',
  'Enjoy every moment you have. Because in life, there are no rewinds, only flashbacks.',
  'As you grow older, you’ll find the only things you regret are the things you didn’t do.',
  'Life is not measured by the number of breaths we take, but by the moments that take our breath away.',
  'In the end, it’s not the years in your life that count. It’s the life in your years.',
  'The bad news is time flies. The good news is you’re the pilot.',
  'Life isn’t about waiting for the storm to pass, it’s about learning to dance in the rain.',
  'Life isn’t about finding yourself. Life is about creating yourself.',
  'To live is the rarest thing in the world. Most people exist, that is all.',
  'Life can only be understood backwards; but it must be lived forwards.',
  'In three words I can sum up everything I’ve learned about life: it goes on.',
  'Life moves pretty fast. If you don’t stop and look around once in a while, you could miss it.',
  'Life is like riding a bicycle. To keep your balance, you must keep moving.',
  'Let your dreams be bigger than your fears and your actions louder than your words.',
  'If your dreams do not scare you, they are not big enough.',
  'Build your own dreams, or someone else will hire you to build theirs.',
  'Never give up on a dream just because of the time it will take to accomplish it. The time will pass anyway.',
  'A dream is only a dream until you decide to make it real.',
  'Don’t dream your life, but live your dream.',
  'Always remember to fall asleep with a dream and wake up with a purpose.',
  'Everything you’ve ever wanted is on the other side of fear.',
  'Life shrinks or expands in proportion to one’s courage.',
  'You cannot swim for new horizons until you have courage to lose sight of the shore.',
  'Fall seven times, stand up eight.',
  'Tough times never last, but tough people do.',
  'Only when it is dark enough can you see the stars.',
  'Even the darkest night will end and the sun will rise.',
  'This too shall pass.',
  'Storms make trees take deeper roots.',
  'Every moment is a fresh beginning.',
  'Don’t let yesterday take up too much of today.',
  'Yesterday is gone. Tomorrow has not yet come. We have only today. Let us begin.',
  'Don’t judge each day by the harvest you reap but by the seeds that you plant.',
  'No one can go back and make a brand new start, but anyone can start from now and make a brand new ending.',
  'You cannot change your destination overnight, but you can change your direction overnight.',
  'It is never too late to be what you might have been.',
  'Happiness is not by chance, but by choice.',
  'You do not find the happy life. You make it.',
  'Stay close to anything that makes you glad you are alive.',
  'Love the life you live. Live the life you love.',
  'Life is to be enjoyed, not endured.',
  'Everyone wants to live on top of the mountain, but all the happiness and growth occurs while you’re climbing it.',
  'Life is ours to be spent, not to be saved.',
  'At some point, your candle will go out, so make use of the light.',
  'So have adventures. Go exploring. Drive around at midnight. Life is so short, and there’s no day like today.',
  'Life is a journey, and if you fall in love with the journey, you will be in love forever.',
  'Be a voice, not an echo.',
];

const ALL = [...NOTES.map((text) => ({ kind: 'note', text })), ...QUOTES.map((text) => ({ kind: 'quote', text }))];
let bag = [];
let last = -1;

/** Random line; every line shows once before any repeats. */
export function nextQuote() {
  if (!bag.length) {
    bag = ALL.map((_, i) => i).filter((i) => i !== last);
    for (let i = bag.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [bag[i], bag[j]] = [bag[j], bag[i]];
    }
  }
  last = bag.pop();
  return ALL[last];
}

export const COUNTS = { notes: NOTES.length, quotes: QUOTES.length };
