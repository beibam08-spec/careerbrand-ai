// These patterns identify self-reports and their payloads. A technology or
// organization mentioned elsewhere in a message is not a claim of competence.
const skillClaims = {
  assertion: [
    /^(?:i\s+)?(?:(?:already\s+)?(?:know how to use|know|use|mastered|work with|worked with)|(?:am\s+)?(?:proficient|skilled) (?:in|with)|(?:have\s+)?experience (?:with|in|using)|(?:can\s+)?(?:use|work with))\s+(.+)$/iu,
    /^(?:я\s+)?(?:знаю|владею|освоил[а]?|использую|работаю с|умею (?:работать с|пользоваться)|(?:у меня )?есть опыт работы с)\s+(.+)$/iu,
    /^(?:мен\s+)?(.+?)\s+(?:білемін|білем|меңгердім|игердім|қолданамын|қолдана аламын|жұмыс істей аламын)[.!]?$/iu,
    /^(?:my skills|skills|мои навыки|навыки|менің дағдыларым|дағдыларым|дағдылар)\s*[:—]\s*(.+)$/iu
  ],
  denial: [
    /^(?:i\s+)?(?:(?:have|got)\s+)?(?:zero|no)\s+(?:hands-on\s+)?experience\s+(?:with|in|using)\s+(.+)$/iu,
    /^(?:i\s+)?(?:(?:do not|don['’]t|did not|didn['’]t|have not|haven['’]t|no longer|never)\s+(?:know how to use|know|use|used|work with|worked with)|(?:am\s+)?(?:not\s+(?:proficient|skilled) (?:in|with)|unfamiliar with)|lack experience (?:with|in))\s+(.+)$/iu,
    /^(?:я\s+)?(?:не (?:знаю|владею|умею пользоваться|работал[а]? с)|(?:у меня )?(?:нет|ноль) опыта(?: работы)? (?:с|в))\s+(.+)$/iu,
    /^(?:мен(?:ің)?\s+)?(.+?)\s+(?:(?:бойынша|қолдану)\s+)?(?:тәжірибем\s+(?:жоқ|нөл)|білмеймін|меңгермедім|игермедім|қолданбадым)[.!]?$/iu,
    /^(?:but\s+|но\s+|бірақ\s+)?(?:not|не|емес)\s+(.+)$/iu
  ]
};

const careerClaims = {
  experience: {
    assertion: [
      /^(?:i\s+)?(?:(?:have )?worked (?:at|for|as|in)|(?:currently )?work (?:at|for|as)|was employed (?:at|by)|interned (?:at|with)|served as)\s+(.+)$/iu,
      /^(?:я\s+)?(?:работал[а]? (?:в|на|как)|проходил[а]? стажировку в)\s+(.+)$/iu,
      /^(?:мен\s+)?(.+?)\s+(?:жұмыс істедім|тағылымдамадан өттім)[.!]?$/iu,
      /^(?:my (?:work )?experience|work experience|мой опыт работы|опыт работы|менің жұмыс тәжірибем|жұмыс тәжірибем)\s*[:—]\s*(.+)$/iu
    ],
    denial: [
      /^(?:i\s+)?(?:never|did not|didn['’]t|have not|haven['’]t)\s+(?:work(?:ed)? (?:at|for|as|in)|(?:been )?employed (?:at|by)|intern(?:ed)? (?:at|with)|join(?:ed)?)\s+(.+)$/iu,
      /^(?:я\s+)?(?:не|никогда не)\s+работал[а]?\s+(?:в|на|как)\s+(.+)$/iu,
      /^(?:мен\s+)?(.+?)\s+(?:жұмыс істемедім|жұмыс істеген жоқпын|тағылымдамадан өтпедім)[.!]?$/iu
    ],
    blanketDenial: /^(?:i have (?:zero|no) (?:work|employment|professional) experience|у меня нет опыта работы|(?:менің )?жұмыс тәжірибем жоқ)[.!]?$/iu
  },
  achievements: {
    assertion: [
      /^(?:i\s+)?(?:won|earned|received|was awarded|achieved|placed)\s+(.+)$/iu,
      /^(?:я\s+)?(?:выиграл[а]?|получил[а]?|занял[а]?|завоевал[а]?)\s+(.+)$/iu,
      /^(?:мен\s+)?(.+?)\s+(?:жеңіп алдым|марапат алдым|орын алдым|марапатталдым|жеңдім)[.!]?$/iu,
      /^(?:my achievements|achievements|мои достижения|достижения|менің жетістіктерім|жетістіктерім)\s*[:—]\s*(.+)$/iu
    ],
    denial: [
      /^(?:i\s+)?(?:never|did not|didn['’]t|have not|haven['’]t)\s+(?:win|won|earn(?:ed)?|receive(?:d)?|achieve(?:d)?|place(?:d)?)\s+(.+)$/iu,
      /^(?:я\s+)?(?:не|никогда не)\s+(?:выиграл[а]?|получил[а]?|занял[а]?|завоевал[а]?)\s+(.+)$/iu,
      /^(?:мен\s+)?(.+?)\s+(?:жеңбедім|жеңіп алмадым|марапат алмадым|орын алмадым)[.!]?$/iu
    ]
  }
};

const listSeparator = /[,;\r\n]+|\s+(?:but also|но и|сондай-ақ|а также|and|и|және|мен|бен|пен)\s+/iu;

function cleanItem(value) {
  return value.trim().replace(/^[\s:«“"'’]+|[\s.,;:!?»”"'’]+$/gu, '')
    .replace(/-(?:ды|ді|ты|ті|ны|ні|мен|бен|пен)$/iu, '').trim();
}

export function expandAdditive(statement) {
  return statement
    .replace(/\bnot only\s+(.+?)\s*,?\s+but also\s+/iu, '$1 and ')
    .replace(/не только\s+(.+?)\s*,?\s+но и\s+/iu, '$1 и ')
    .replace(/\s+ғана емес\s*,?\s*(?:сонымен қатар\s+|сондай-ақ\s+)?(?=\S)/iu, ' және ');
}

export function skillItems(value) {
  return expandAdditive(value).split(listSeparator).map(item =>
    cleanItem(item.replace(/\s+(?:да|де|та|те)[.!]?$/iu, ''))).filter(Boolean);
}

function extract(patterns, text) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[1];
  }
  return '';
}

// Skills are individual propositions, so a draft can retain one independently
// supported item even if another item in the same model response is denied.
export function extractSkills(statement, kind) {
  const value = extract(skillClaims[kind], statement);
  return value ? skillItems(value) : [];
}

export function extractCareerClaim(statement, field, kind) {
  const rules = careerClaims[field];
  if (kind === 'denial' && rules.blanketDenial?.test(statement)) return {all:true};
  const target = cleanItem(extract(rules[kind], statement));
  return target ? {target} : null;
}
