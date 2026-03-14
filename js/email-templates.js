// ============================================
// SAFE Action - Email Template Library
// ============================================
// 100 subject lines + 50 body variants per action type
// Rotated per-contact to avoid spam filter pattern detection
// ============================================

window._templateSeed = Date.now();

/**
 * Deterministic template index based on rep name.
 * Same rep gets same template within a session, different across visits.
 */
function getTemplateIndex(repName, poolLength, type) {
    var key = repName + '|' + type + '|' + window._templateSeed;
    var hash = 0;
    for (var i = 0; i < key.length; i++) {
        hash = ((hash << 5) - hash) + key.charCodeAt(i);
        hash |= 0;
    }
    return Math.abs(hash) % poolLength;
}

/**
 * Fill placeholders in template string.
 * Supported: {name}, {city}, {state}, {title}, {lastName}, {fullName},
 *            {billNumber}, {billTitle}, {pledgeUrl}
 */
function fillTemplate(template, vars) {
    return template
        .replace(/\{name\}/g, vars.name || '')
        .replace(/\{city\}/g, vars.city || '')
        .replace(/\{state\}/g, vars.state || '')
        .replace(/\{title\}/g, vars.title || '')
        .replace(/\{lastName\}/g, vars.lastName || '')
        .replace(/\{fullName\}/g, vars.fullName || '')
        .replace(/\{billNumber\}/g, vars.billNumber || '')
        .replace(/\{billTitle\}/g, vars.billTitle || '')
        .replace(/\{pledgeUrl\}/g, vars.pledgeUrl || 'https://scienceandfreedom.com/quiz');
}

// ────────────────────────────────────────────
// PLEDGE REQUEST TEMPLATES
// ────────────────────────────────────────────

var EMAIL_TEMPLATES = {
  pledge: {
    subjects: [
      // Question format (20)
      "Will you take the SAFE Action science pledge, {title} {lastName}?",
      "Can we count on you to stand for science, {title} {lastName}?",
      "Where do you stand on science and public health?",
      "Will you commit to evidence-based policy?",
      "Would you take a stand for public health in {state}?",
      "Can {state} count on your support for science?",
      "Will you join the growing list of pro-science leaders?",
      "Where does science rank in your priorities, {title} {lastName}?",
      "Would you pledge to protect public health in our community?",
      "Can your constituents trust you on science policy?",
      "Will you support evidence-based legislation in {state}?",
      "Do you stand with science, {title} {lastName}?",
      "Can we rely on you for science-based health policy?",
      "Will you be a champion for public health this session?",
      "Where do you stand on evidence-based medicine?",
      "Would you commit to science-first policymaking?",
      "Can {state} families count on your science support?",
      "Will you protect science education in our state?",
      "Do you support evidence-based public health measures?",
      "Would you take the pro-science pledge today?",

      // Statement format (20)
      "A constituent request: take the SAFE Action pledge",
      "Your constituents need you to stand for science",
      "Science matters to voters in {city}, {state}",
      "Requesting your commitment to evidence-based policy",
      "Standing up for science in {state} — will you join?",
      "Your community is watching: the SAFE Action pledge",
      "{state} families need evidence-based leadership",
      "A message from a constituent about science policy",
      "Supporting science-based public health in {state}",
      "Constituent request regarding science and health policy",
      "The SAFE Action pledge — your chance to lead on science",
      "Evidence-based policy matters to your constituents",
      "We need science champions in {state} government",
      "A request from {city}: commit to science-based policy",
      "Your voice on science matters, {title} {lastName}",
      "Constituent letter: science and public health priorities",
      "Take the pledge for evidence-based policy in {state}",
      "{city} constituent urging science-first leadership",
      "Science policy commitment — from a concerned voter",
      "Your support for evidence-based health policy matters",

      // Urgency format (20)
      "Now more than ever, {state} needs science-based leaders",
      "Urgent: anti-science legislation threatens {state}",
      "Science is under attack — we need your voice",
      "Time-sensitive: pledge your support for public health",
      "Anti-science bills are advancing — where do you stand?",
      "{state} public health is at a crossroads",
      "Our children's health depends on science-based policy",
      "Critical moment for science policy in {state}",
      "Don't let anti-science legislation go unchallenged",
      "Public health protections need your support now",
      "The fight for evidence-based policy needs you",
      "Science-based health policy can't wait",
      "Your leadership on science matters more than ever",
      "Protecting public health in {state} — act now",
      "Anti-science sentiment is growing — take a stand",
      "Our community needs science champions right now",
      "Health misinformation threatens {state} — lead with science",
      "Evidence-based policy is under threat in our state",
      "Don't let pseudoscience drive {state} health policy",
      "Your constituents are counting on science-based leadership",

      // Community angle (20)
      "A {city} family asking for science-based leadership",
      "Our neighborhood cares about evidence-based policy",
      "Parents in {city} want science-based health policy",
      "Teachers, nurses, and scientists in {state} need your pledge",
      "Healthcare workers in your district support science policy",
      "As a {city} resident, I'm asking you to stand for science",
      "Our community values science — do you?",
      "Families in your district deserve evidence-based policy",
      "Local health matters: the SAFE Action pledge",
      "Your neighbors in {city} care about science policy",
      "Community health depends on science-based decisions",
      "A voter in {city} asking about your science stance",
      "{state} educators want evidence-based health policy",
      "From a concerned parent in {city} about science policy",
      "Our schools and hospitals need pro-science leaders",
      "A {city} healthcare worker's request on science policy",
      "Protecting {city} families through evidence-based policy",
      "Your community is asking: will you stand for science?",
      "Local voices for science in {city}, {state}",
      "A constituent's hope for science-based governance",

      // Personal angle (20)
      "I believe in science, and I vote — do you stand with me?",
      "Why science policy matters to me personally",
      "My family's health depends on evidence-based policy",
      "A personal request from a science supporter in {city}",
      "Why I'm writing to you about science and health",
      "As someone who trusts science, I need your commitment",
      "Science saved my family — please protect it in policy",
      "Why evidence-based health policy is personal to me",
      "I'm a voter who cares deeply about science — here's why",
      "My story: why science policy matters in {state}",
      "From a {city} voter who believes in science",
      "Why I'm asking you to take the SAFE Action pledge",
      "Science isn't political — but I need your commitment",
      "A letter from someone who trusts evidence over ideology",
      "Why I chose to write to you about public health",
      "My reasons for supporting science-based policy",
      "As a concerned citizen in {city}, I urge your science pledge",
      "What science means to me and my community",
      "Personal note: why your science stance matters to voters",
      "I'm reaching out because science matters to my family"
    ],

    bodies: [
      // Formal (10)
      "Dear {title} {lastName},\n\nAs your constituent in {city}, {state}, I am writing to respectfully ask you to take the SAFE Action pledge in support of evidence-based science and public health policy.\n\nIn a time when misinformation about vaccines, public health, and scientific research is increasingly shaping legislation, it is crucial that our elected officials commit to making decisions grounded in peer-reviewed science.\n\nThe SAFE Action pledge is a simple commitment to prioritize scientific evidence when considering health-related legislation. You can learn more and take the pledge at: {pledgeUrl}\n\nThank you for your service to our community.\n\nSincerely,\n{name}\n{city}, {state}",

      "Dear {title} {lastName},\n\nI am a resident of {city}, {state}, and I care deeply about evidence-based public health policy in our state.\n\nI am writing to encourage you to take the SAFE Action pledge, which demonstrates your commitment to using scientific evidence as the foundation for health policy decisions.\n\nScience-based policymaking protects families, strengthens our healthcare system, and ensures that legislative decisions are grounded in facts rather than misinformation.\n\nPlease visit {pledgeUrl} to learn more about the pledge and how you can show your constituents that you stand for science.\n\nRespectfully,\n{name}\n{city}, {state}",

      "Dear {title} {lastName},\n\nThank you for your service to the people of {state}. I'm reaching out as a constituent who believes that sound science should be the foundation of public health policy.\n\nThe SAFE Action Fund has created a pledge for elected officials who commit to evidence-based policy. I would be proud to know that my representative has taken this pledge.\n\nYou can review the pledge details here: {pledgeUrl}\n\nI appreciate your time and consideration.\n\nBest regards,\n{name}\n{city}, {state}",

      "Dear {title} {lastName},\n\nAs a voter in your district, I want you to know that science-based public health policy is a priority for me and many of your constituents.\n\nI'm writing to ask if you would consider taking the SAFE Action pledge — a commitment to support legislation that is rooted in scientific evidence and protects public health.\n\nMore information is available at: {pledgeUrl}\n\nI believe this pledge would demonstrate strong leadership and earn the trust of voters who value evidence-based governance.\n\nThank you,\n{name}\n{city}, {state}",

      "Dear {title} {lastName},\n\nI hope this message finds you well. As one of your constituents in {city}, I'm writing about something I feel strongly about: the role of science in our state's policymaking.\n\nThe SAFE Action Fund invites elected officials to take a pledge supporting evidence-based health policy. Taking this pledge would send a powerful message to your constituents that you prioritize facts and science.\n\nLearn more: {pledgeUrl}\n\nThank you for representing us.\n\nWarm regards,\n{name}\n{city}, {state}",

      "Dear {title} {lastName},\n\nI am a constituent in {city} who follows legislative activities closely, particularly regarding public health.\n\nI have learned about the SAFE Action pledge, which asks elected officials to commit to supporting evidence-based science and health policy. Given the current landscape of health misinformation, I believe this commitment is more important than ever.\n\nWould you consider taking this pledge? Details: {pledgeUrl}\n\nYour leadership on this issue would mean a great deal to families in our community.\n\nSincerely,\n{name}\n{city}, {state}",

      "Dear {title} {lastName},\n\nScience-based public health policy saves lives and protects communities. That's why I'm asking you to take the SAFE Action pledge — a commitment by elected officials to stand for evidence over ideology.\n\nAs your constituent, I want to know that my representative will consider the best available scientific evidence when making decisions about public health.\n\nYou can take the pledge at: {pledgeUrl}\n\nThank you for your consideration.\n\n{name}\n{city}, {state}",

      "Dear {title} {lastName},\n\nI'm writing to you today as a concerned citizen of {city}, {state}. With increasing debates around science and health policy, I believe it's important for our elected officials to clearly state their position.\n\nThe SAFE Action pledge offers a meaningful way to demonstrate your commitment to evidence-based policymaking. I encourage you to learn more at {pledgeUrl}.\n\nOur community deserves leaders who trust science and defend public health.\n\nRespectfully yours,\n{name}\n{city}, {state}",

      "Dear {title} {lastName},\n\nPublic trust in science-based policy is essential for the health and safety of {state} residents. I'm reaching out to ask you to consider taking the SAFE Action pledge.\n\nThis pledge is a straightforward commitment to use peer-reviewed scientific evidence as a guiding principle in legislative decisions about public health.\n\nLearn more and take the pledge: {pledgeUrl}\n\nI look forward to hearing about your commitment to science.\n\nBest,\n{name}\n{city}, {state}",

      "Dear {title} {lastName},\n\nAs we face ongoing challenges to public health in {state}, I believe it is critical that our representatives commit to evidence-based decision-making.\n\nI am writing to ask you to take the SAFE Action pledge — a public commitment to prioritize science in health-related legislation. This would give your constituents confidence that their health and safety are in capable hands.\n\nPledge details: {pledgeUrl}\n\nThank you for your time.\n\nSincerely,\n{name}\n{city}, {state}",

      // Conversational (10)
      "Hi {title} {lastName},\n\nI'm {name} from {city}, and I wanted to reach out about something that's been on my mind — the role of science in our state's health policy.\n\nI recently learned about the SAFE Action pledge, which asks elected officials to commit to evidence-based policymaking. It's not partisan — it's about using the best science we have to protect public health.\n\nWould you consider taking a look? {pledgeUrl}\n\nThanks for your time!\n\n{name}\n{city}, {state}",

      "Hello {title} {lastName},\n\nI'm a constituent from {city} and I care a lot about making sure our state's health policies are based on real science.\n\nI came across the SAFE Action pledge and thought of you. It's a way for elected officials to show they're committed to evidence-based policy. I think it would mean a lot to voters like me.\n\nHere's the link: {pledgeUrl}\n\nI'd love to see your name on the list!\n\n{name}",

      "Hey there {title} {lastName},\n\nI know you're busy, so I'll keep this short. As one of your constituents in {city}, I care about science-based health policy.\n\nThere's a pledge from the SAFE Action Fund that lets officials publicly commit to evidence-based policymaking. I think it's something worth checking out: {pledgeUrl}\n\nWould love to see you take it.\n\nThanks,\n{name}",

      "Hi {title} {lastName},\n\nI'm writing because I believe science should guide our health policies — and I want to know that you do too.\n\nThe SAFE Action pledge is a simple way to show your constituents that you value evidence-based decision-making. It's not about any one issue — it's about committing to follow the science.\n\nCheck it out here: {pledgeUrl}\n\nHoping to hear good news!\n\nBest,\n{name}\n{city}, {state}",

      "Hello {title} {lastName},\n\nAs a voter in {city}, I want you to know that science and public health are top priorities for me.\n\nI've been following the SAFE Action pledge — it's a way for officials to publicly commit to evidence-based health policy. I'd be really proud if my representative took that stand.\n\nMore info: {pledgeUrl}\n\nThanks for all you do.\n\n{name}",

      "Hi {title} {lastName},\n\nHope you're doing well! I'm reaching out from {city} because science-based policy is something I care about deeply.\n\nHave you heard of the SAFE Action pledge? It's a commitment to evidence-based health policymaking, and I think it would resonate with a lot of your constituents.\n\nHere's the link if you want to check it out: {pledgeUrl}\n\nThanks for your time,\n{name}",

      "Dear {title} {lastName},\n\nI'm {name} — a voter, taxpayer, and science supporter in {city}.\n\nI'd like to invite you to take the SAFE Action pledge. It's a public commitment to base health policy decisions on scientific evidence. In a time of widespread misinformation, this kind of leadership matters.\n\n{pledgeUrl}\n\nI appreciate you reading this.\n\n{name}",

      "Hello {title} {lastName},\n\nScience shouldn't be political, but lately it has been. That's why the SAFE Action pledge matters — it's a clear signal from elected officials that evidence comes first.\n\nAs your constituent in {city}, I'm asking you to consider taking this pledge. It would mean a lot to people like me who want to trust that our leaders follow the facts.\n\n{pledgeUrl}\n\nThank you,\n{name}",

      "Hi {title} {lastName},\n\nI live in {city} and I vote in every election. One of the things I look for in my representatives is a commitment to evidence-based policy.\n\nThe SAFE Action pledge is a way to show that commitment publicly. I'd really appreciate it if you took a moment to look at it: {pledgeUrl}\n\nIt means a lot to families like mine.\n\nGratefully,\n{name}",

      "Hello {title} {lastName},\n\nQuick note from a constituent in {city}: I'd love to see you take the SAFE Action pledge for evidence-based health policy.\n\nIt's a simple but meaningful step that shows voters you prioritize science over misinformation. Here's where to learn more: {pledgeUrl}\n\nThanks for representing us.\n\n{name}\n{city}, {state}",

      // Passionate/urgent (10)
      "Dear {title} {lastName},\n\nAnti-science legislation is on the rise in {state}, and I'm concerned about where we're headed. Misinformation about vaccines and public health is making its way into our laws.\n\nThat's why I'm urging you to take the SAFE Action pledge — a clear, public commitment to evidence-based health policy. Our families' health depends on leaders who trust science.\n\n{pledgeUrl}\n\nPlease don't let pseudoscience win in {state}.\n\nUrgently,\n{name}\n{city}, {state}",

      "{title} {lastName},\n\nI'll be direct: science is under attack in state legislatures across the country, and {state} is not immune.\n\nBills that undermine vaccination programs, weaken public health protections, and ignore scientific evidence are being introduced right now. We need leaders who will push back.\n\nThe SAFE Action pledge is your chance to stand on the right side. {pledgeUrl}\n\nPlease take this seriously.\n\n{name}\n{city}, {state}",

      "Dear {title} {lastName},\n\nEvery day, misinformation about health and science spreads further. As a parent in {city}, it terrifies me that this misinformation could shape the laws of our state.\n\nI'm begging you — please take the SAFE Action pledge. Show your constituents that you believe in evidence-based medicine and public health.\n\n{pledgeUrl}\n\nOur kids are counting on leaders like you.\n\n{name}\n{city}, {state}",

      "Dear {title} {lastName},\n\nAs a healthcare professional in {city}, I see the consequences of anti-science policy every day. When leaders don't stand for evidence-based medicine, patients suffer.\n\nPlease take the SAFE Action pledge and commit to science-based health policy. Your constituents who work in medicine, nursing, and public health need to know you have our backs.\n\n{pledgeUrl}\n\nThe science is clear. Will you stand with it?\n\n{name}\n{city}, {state}",

      "Dear {title} {lastName},\n\nI'm a teacher in {city}, and I'm deeply worried about the anti-science movement affecting our state. My students deserve to grow up in a state where policy is based on facts, not fear.\n\nPlease consider taking the SAFE Action pledge — it's a commitment to evidence-based policy that would send a powerful message to educators and families.\n\n{pledgeUrl}\n\nOur children's future depends on it.\n\n{name}\n{city}, {state}",

      "Dear {title} {lastName},\n\nThis is not a form letter. I am a real person in {city}, {state}, and I am genuinely concerned about the anti-science trend in our legislature.\n\nI'm asking you — person to person — to take the SAFE Action pledge. It's a commitment to let scientific evidence guide health policy. Nothing more, nothing less.\n\n{pledgeUrl}\n\nI will be watching how you respond. And I will be voting.\n\n{name}\n{city}, {state}",

      "{title} {lastName},\n\nLet me be honest with you. As a voter in your district, I'm looking for leaders who will stand up for science. Not vaguely — concretely.\n\nThe SAFE Action pledge gives you a chance to do exactly that. It's a public commitment to evidence-based health policy. And right now, with anti-science bills moving through {state}, it matters more than ever.\n\n{pledgeUrl}\n\nI hope you'll take it.\n\n{name}\n{city}, {state}",

      "Dear {title} {lastName},\n\nWhen the next public health crisis hits {state} — and it will — I want to know that my elected officials are ready to follow the science.\n\nThe SAFE Action pledge is about preparedness and trust. It tells your constituents: I will make decisions based on evidence, not ideology.\n\nPlease take the pledge: {pledgeUrl}\n\n{name}\n{city}, {state}",

      "Dear {title} {lastName},\n\nI watched what happened during the pandemic when leaders ignored scientific guidance. People got sick. People died. I don't want to see that happen again in {state}.\n\nPlease commit to evidence-based health policy by taking the SAFE Action pledge. It's a small step that sends a huge message.\n\n{pledgeUrl}\n\nThe stakes are real.\n\n{name}\n{city}, {state}",

      "Dear {title} {lastName},\n\nScience gave us vaccines that saved millions of lives. It gave us clean water standards and food safety rules. Every day, evidence-based policy protects your constituents.\n\nBut that's all at risk when anti-science legislation advances unchecked. That's why I'm asking you to take the SAFE Action pledge — a clear commitment to protect science in {state}.\n\n{pledgeUrl}\n\nHistory is watching.\n\n{name}\n{city}, {state}",

      // Short/punchy (10)
      "Dear {title} {lastName},\n\nScience matters. Will you commit to it?\n\nAs your constituent, I'm asking you to take the SAFE Action pledge for evidence-based health policy: {pledgeUrl}\n\nThank you,\n{name}\n{city}, {state}",

      "{title} {lastName} — As a voter in {city}, I want to know: do you stand for science?\n\nPlease take the SAFE Action pledge: {pledgeUrl}\n\n{name}",

      "Dear {title} {lastName},\n\nOne question: Will you commit to evidence-based health policy?\n\nThe SAFE Action pledge makes it official: {pledgeUrl}\n\nYour constituents are watching.\n\n{name}\n{city}, {state}",

      "Dear {title} {lastName},\n\nI'm {name} from {city}. I support science. I vote. And I want my representative to take the SAFE Action pledge.\n\n{pledgeUrl}\n\nSimple as that.\n\n{name}",

      "{title} {lastName},\n\nScience protects families. Anti-science policy puts them at risk.\n\nPlease stand with science and take the SAFE Action pledge: {pledgeUrl}\n\n— {name}, {city}, {state}",

      "Dear {title} {lastName},\n\nVoters notice when leaders take a stand. Take the SAFE Action pledge for science: {pledgeUrl}\n\nIt matters.\n\n{name}\n{city}, {state}",

      "Dear {title} {lastName},\n\nEvidence-based policy isn't radical. It's responsible.\n\nPlease take the SAFE Action pledge: {pledgeUrl}\n\nThank you for your service.\n\n{name}\n{city}, {state}",

      "{title} {lastName},\n\nFrom a voter in {city}: please commit to science-based health policy.\n\nSAFE Action pledge: {pledgeUrl}\n\nI appreciate your leadership.\n\n{name}",

      "Dear {title} {lastName},\n\nQuick ask: take the SAFE Action pledge. It shows voters you prioritize evidence over misinformation.\n\n{pledgeUrl}\n\nThank you!\n{name}, {city}",

      "Dear {title} {lastName},\n\nScience isn't a partisan issue. Please show your constituents you agree by taking the SAFE Action pledge.\n\n{pledgeUrl}\n\nRespectfully,\n{name}\n{city}, {state}",

      // Story-based (10)
      "Dear {title} {lastName},\n\nMy grandmother survived polio because of the vaccine. My children are healthy because of evidence-based medicine. I write to you today because I believe science-based policy is worth protecting.\n\nPlease take the SAFE Action pledge and commit to evidence-based health policy for {state}: {pledgeUrl}\n\nScience has protected my family. I'm asking you to protect science.\n\n{name}\n{city}, {state}",

      "Dear {title} {lastName},\n\nWhen my child was born, I trusted the science that kept them healthy — from prenatal care to vaccinations. That trust isn't something I take for granted.\n\nThat's why I'm asking you to take the SAFE Action pledge. Our families need leaders who will defend evidence-based health policy in {state}.\n\n{pledgeUrl}\n\nThank you for listening.\n\n{name}\n{city}, {state}",

      "Dear {title} {lastName},\n\nI work in healthcare, and I've seen what happens when people follow misinformation instead of science. It's heartbreaking.\n\nAs your constituent, I'm asking you to take the SAFE Action pledge — a commitment to evidence-based health policy. It would mean a lot to the healthcare workers in your district.\n\n{pledgeUrl}\n\nThank you,\n{name}\n{city}, {state}",

      "Dear {title} {lastName},\n\nI'm a science teacher in {city}. Every day, I teach my students to value evidence, question claims, and think critically. I want them to see those same values reflected in their government.\n\nPlease take the SAFE Action pledge: {pledgeUrl}\n\nYou'd be a role model for the next generation.\n\n{name}\n{city}, {state}",

      "Dear {title} {lastName},\n\nMy neighbor recently fell for health misinformation online and made medical decisions that put their family at risk. It was a wake-up call for me.\n\nWe need leaders who stand for science. The SAFE Action pledge is a meaningful way to show you're one of them: {pledgeUrl}\n\nPlease consider it.\n\n{name}\n{city}, {state}",

      "Dear {title} {lastName},\n\nDuring the pandemic, my family relied on science — we followed the guidance, got vaccinated, and stayed safe. Not everyone was so lucky.\n\nI'm writing because I want {state} to be a place where policy follows the evidence. The SAFE Action pledge is a step in that direction: {pledgeUrl}\n\nOur community needs your leadership on this.\n\n{name}\n{city}, {state}",

      "Dear {title} {lastName},\n\nI lost a loved one to a preventable disease. Science could have saved them, but misinformation got in the way.\n\nThat experience drives me to ask elected officials like you to stand for science. Please take the SAFE Action pledge and commit to evidence-based health policy in {state}.\n\n{pledgeUrl}\n\nIt's deeply personal to me, and I know I'm not alone.\n\n{name}\n{city}, {state}",

      "Dear {title} {lastName},\n\nI moved to {city} to raise my family somewhere that values education and science. I'm proud to live here — and I want to be proud of my representatives too.\n\nTaking the SAFE Action pledge would show that you share those values: {pledgeUrl}\n\nI'll be watching with hope.\n\n{name}\n{city}, {state}",

      "Dear {title} {lastName},\n\nAs a nurse in {city}, I've spent my career following the evidence. I've seen lives saved by science — and lives lost when people turn away from it.\n\nI'm asking you to take the SAFE Action pledge and commit to evidence-based health policy: {pledgeUrl}\n\nHealthcare workers like me need to know our leaders trust the science too.\n\n{name}\n{city}, {state}",

      "Dear {title} {lastName},\n\nMy kids ask me questions about science every day. \"Why do we get vaccines?\" \"How do doctors know what medicine to give?\" I answer them truthfully: because of evidence.\n\nI want them to grow up in a state where their leaders answer the same way. Please take the SAFE Action pledge: {pledgeUrl}\n\nFor the next generation.\n\n{name}\n{city}, {state}"
    ]
  },

  // ────────────────────────────────────────────
  // BILL OPPOSITION TEMPLATES
  // ────────────────────────────────────────────

  oppose: {
    subjects: [
      // Question format (20)
      "Will you oppose {billNumber}? It threatens public health",
      "Where do you stand on {billNumber}, {title} {lastName}?",
      "Can we count on you to vote NO on {billNumber}?",
      "Will you protect public health by opposing {billNumber}?",
      "Can {state} families count on you to stop {billNumber}?",
      "{billNumber} threatens science — will you oppose it?",
      "Will you stand against anti-science {billNumber}?",
      "Can your constituents trust you to oppose {billNumber}?",
      "{title} {lastName}, will you vote against {billNumber}?",
      "Will you reject {billNumber} and protect public health?",
      "Do you support science over {billNumber}?",
      "Can you commit to opposing {billNumber}?",
      "Where will you stand when {billNumber} comes to a vote?",
      "Will {state} families be safe if {billNumber} passes?",
      "Can I count on you to fight {billNumber}?",
      "Will you protect evidence-based policy by opposing {billNumber}?",
      "Do you recognize the danger in {billNumber}?",
      "Will you put public health over politics on {billNumber}?",
      "Can we rely on your opposition to {billNumber}?",
      "{billNumber} undermines science — are you with us?",

      // Statement format (20)
      "Opposing {billNumber} — a constituent's request",
      "Vote NO on {billNumber} to protect public health",
      "Constituent concern: {billNumber} threatens evidence-based policy",
      "{billNumber} will harm {state} families — please oppose",
      "A request to vote against {billNumber}",
      "Stand against {billNumber} and for science",
      "{state} doesn't need {billNumber} — please oppose it",
      "Reject {billNumber}: protect public health in {state}",
      "Your NO vote on {billNumber} matters to constituents",
      "Constituent urging opposition to {billNumber}",
      "Please oppose {billNumber} — science depends on it",
      "{billNumber} threatens public health protections",
      "Requesting your opposition to anti-science {billNumber}",
      "Vote against {billNumber} for the health of {state}",
      "{billNumber} puts families at risk — please vote NO",
      "Protect science: oppose {billNumber}",
      "A vote against {billNumber} is a vote for public health",
      "Standing against {billNumber} — from a {city} voter",
      "Please say NO to {billNumber}",
      "Oppose {billNumber}: {state} families need science-based policy",

      // Urgency format (20)
      "URGENT: {billNumber} must be stopped for public health",
      "{billNumber} is advancing — please act now",
      "Time is running out to stop {billNumber}",
      "Don't let {billNumber} pass — public health is at stake",
      "{billNumber} could devastate {state} public health",
      "Critical: vote NO on {billNumber} before it's too late",
      "Anti-science {billNumber} needs your opposition NOW",
      "{state} families can't afford {billNumber} — act now",
      "Stop {billNumber} before it undermines public health",
      "{billNumber} is a direct threat to science — oppose immediately",
      "Urgent constituent request: block {billNumber}",
      "{billNumber} will set {state} back decades — please oppose",
      "The clock is ticking on {billNumber} — we need your vote",
      "Don't let {billNumber} become law",
      "{billNumber} threatens children's health — act immediately",
      "Emergency: {billNumber} endangers public health protections",
      "Your vote on {billNumber} could protect thousands",
      "{billNumber} is dangerous and must be defeated",
      "Now or never: oppose {billNumber} for {state}",
      "Please stop {billNumber} — our health depends on it",

      // Community angle (20)
      "Families in {city} are worried about {billNumber}",
      "Your constituents oppose {billNumber} — here's why",
      "Parents in your district are concerned about {billNumber}",
      "Healthcare workers in {city} urge NO on {billNumber}",
      "{city} families need you to oppose {billNumber}",
      "Educators in {state} are alarmed by {billNumber}",
      "Local health professionals oppose {billNumber}",
      "Community health at risk: please oppose {billNumber}",
      "Nurses and doctors in your district say NO to {billNumber}",
      "Teachers in {city} want you to oppose {billNumber}",
      "{state} scientists urge your opposition to {billNumber}",
      "Our community can't afford {billNumber}",
      "Voters in {city} stand against {billNumber}",
      "Public health workers oppose {billNumber} — please listen",
      "From {city}: we need you to fight {billNumber}",
      "Our schools and hospitals will suffer under {billNumber}",
      "The {city} community speaks out against {billNumber}",
      "Your neighbors say NO to {billNumber}",
      "{state} families united against {billNumber}",
      "A coalition of {city} voters opposing {billNumber}",

      // Personal angle (20)
      "Why I'm personally worried about {billNumber}",
      "As a parent, {billNumber} scares me",
      "{billNumber} threatens my family's health",
      "Why I'm asking you to oppose {billNumber}",
      "This is personal: please vote NO on {billNumber}",
      "My family's well-being depends on defeating {billNumber}",
      "A personal plea to oppose {billNumber}",
      "Why {billNumber} matters to a voter in {city}",
      "I'm writing because {billNumber} could hurt my family",
      "Please hear me out on {billNumber}",
      "One voter's perspective on why {billNumber} is dangerous",
      "My story and why {billNumber} must be stopped",
      "As someone affected by this issue, please oppose {billNumber}",
      "Why I lose sleep over {billNumber}",
      "{billNumber} isn't just policy — it's personal",
      "A personal request from a concerned constituent on {billNumber}",
      "Why your vote on {billNumber} matters to me",
      "I'm counting on you to oppose {billNumber}",
      "From a {city} voter who cares deeply about {billNumber}",
      "My reasons for opposing {billNumber} — and asking you to as well"
    ],

    bodies: [
      // Formal (10)
      "Dear {title} {lastName},\n\nI am writing as your constituent in {city}, {state} to urge you to oppose {billNumber}: {billTitle}.\n\nThis legislation undermines evidence-based public health protections and could put {state} families at risk. Science-based policy is the foundation of public health, and bills like this move us in the wrong direction.\n\nI respectfully ask that you vote NO on {billNumber} and support evidence-based alternatives that protect our community's health.\n\nThank you for your attention to this important matter.\n\nSincerely,\n{name}\n{city}, {state}",

      "Dear {title} {lastName},\n\nAs a resident of {city}, I am deeply concerned about {billNumber} ({billTitle}).\n\nThis bill would weaken public health protections that have been established through decades of scientific research. I believe that our state's health policy should be guided by evidence, not ideology.\n\nPlease oppose this legislation and continue to support science-based public health policy in {state}.\n\nRespectfully,\n{name}\n{city}, {state}",

      "Dear {title} {lastName},\n\nI am writing to express my strong opposition to {billNumber}: {billTitle}.\n\nThis bill goes against established scientific consensus and threatens the public health infrastructure that protects {state} residents. Evidence-based policy should be the standard, and {billNumber} falls short.\n\nI urge you to vote against this legislation.\n\nBest regards,\n{name}\n{city}, {state}",

      "Dear {title} {lastName},\n\nThank you for your service to {state}. I'm reaching out about {billNumber} ({billTitle}), which I believe poses a threat to evidence-based public health policy.\n\nAs your constituent, I urge you to carefully consider the scientific evidence and oppose this bill. Our community's health and safety should not be compromised by legislation that contradicts established science.\n\nI appreciate your consideration.\n\n{name}\n{city}, {state}",

      "Dear {title} {lastName},\n\n{billNumber} — {billTitle} — is a step backward for public health in {state}.\n\nThis legislation contradicts scientific evidence and could undermine protections that keep our communities safe. I'm writing to ask that you oppose this bill and stand with the scientific community.\n\nEvidence-based policy saves lives. Please vote NO on {billNumber}.\n\nSincerely,\n{name}\n{city}, {state}",

      // Conversational (10)
      "Hi {title} {lastName},\n\nI'm {name} from {city}, and I wanted to let you know that I'm really concerned about {billNumber} ({billTitle}).\n\nFrom what I've read, this bill would weaken public health protections that are backed by solid science. I don't think that's the direction {state} should be going.\n\nI hope you'll consider voting against it. It matters a lot to people like me who believe in evidence-based policy.\n\nThanks for listening,\n{name}",

      "Hello {title} {lastName},\n\nI'm a voter in {city} and I want to flag {billNumber} as something I'm concerned about.\n\n{billTitle} — it sounds like it could undermine science-based health policy in our state. I'd really appreciate it if you took a close look at the evidence and opposed this bill.\n\nThanks for your time,\n{name}",

      "Hey {title} {lastName},\n\nJust a quick note from a constituent: please oppose {billNumber} ({billTitle}). It goes against the scientific evidence and could hurt public health in {state}.\n\nI know you get a lot of emails, but this one matters to me.\n\nThanks,\n{name}\n{city}",

      "Hi {title} {lastName},\n\nI've been following {billNumber} and I'm worried. {billTitle} seems like it could set back public health in {state}.\n\nAs someone who trusts science, I'm hoping you'll oppose it. We need leaders who put evidence first.\n\nAppreciate your work,\n{name}\n{city}, {state}",

      "Hello {title} {lastName},\n\nI'm writing about {billNumber} — {billTitle}. I've read about it and I don't think it's good for {state}.\n\nIt seems to go against what the science says, and I'd hate to see our state weaken public health protections. Would you consider opposing it?\n\nThanks for everything you do.\n\n{name}\n{city}",

      // Passionate (10)
      "{title} {lastName},\n\n{billNumber} is dangerous. {billTitle} — this legislation flies in the face of scientific evidence and could put countless {state} families at risk.\n\nAs your constituent, I'm urging you in the strongest terms to vote NO. Public health is not something we can afford to compromise on.\n\nPlease do the right thing.\n\n{name}\n{city}, {state}",

      "Dear {title} {lastName},\n\nI'm alarmed by {billNumber} ({billTitle}). This bill threatens the evidence-based health protections that keep our communities safe.\n\nAs a parent in {city}, this isn't abstract for me — it's about my children's health and safety. Please oppose this bill.\n\nI'm counting on you.\n\n{name}\n{city}, {state}",

      "Dear {title} {lastName},\n\n{billNumber} is anti-science, full stop. {billTitle} would roll back protections that exist because of decades of research.\n\nI am begging you to oppose this bill. The health of {state} residents — including my family — depends on evidence-based policy.\n\nDon't let this become law.\n\n{name}\n{city}, {state}",

      "{title} {lastName},\n\nI'll be blunt: {billNumber} ({billTitle}) is bad policy based on bad science. It will hurt people.\n\nPlease vote NO. Your constituents who follow the evidence are watching.\n\n{name}\n{city}, {state}",

      "Dear {title} {lastName},\n\nEvery public health expert I've spoken with opposes {billNumber}. The science is clear — this bill would harm {state} residents.\n\nI'm asking you to listen to the evidence and vote against {billNumber} ({billTitle}).\n\nOur community's health is at stake.\n\n{name}\n{city}, {state}",

      // Short (10)
      "Dear {title} {lastName},\n\nPlease vote NO on {billNumber} ({billTitle}). It threatens evidence-based public health in {state}.\n\nYour constituent,\n{name}\n{city}, {state}",

      "{title} {lastName} — Oppose {billNumber}. {state} families need evidence-based health policy, not anti-science legislation.\n\n{name}, {city}",

      "Dear {title} {lastName},\n\n{billNumber} undermines science. Please oppose it.\n\nThank you,\n{name}\n{city}, {state}",

      "Dear {title} {lastName},\n\nOne request: vote NO on {billNumber} ({billTitle}). Science and public health in {state} depend on it.\n\n{name}",

      "{title} {lastName},\n\n{billNumber} is anti-science legislation that would weaken public health. Please oppose it.\n\n— {name}, {city}, {state}",

      "Dear {title} {lastName},\n\nAs a voter in {city}, I urge a NO vote on {billNumber}. Evidence-based health policy must be protected.\n\n{name}\n{city}, {state}",

      "Dear {title} {lastName},\n\nProtect public health. Oppose {billNumber} ({billTitle}).\n\nThank you for standing with science.\n\n{name}\n{city}, {state}",

      "{title} {lastName} — Please oppose {billNumber}. It goes against scientific evidence and puts {state} at risk.\n\nRespectfully,\n{name}\n{city}",

      "Dear {title} {lastName},\n\n{billNumber} ({billTitle}) threatens public health protections. I'm asking you to vote against it.\n\n{name}\n{city}, {state}",

      "Dear {title} {lastName},\n\nNO on {billNumber}. Science should guide health policy.\n\nFrom a constituent who cares,\n{name}\n{city}, {state}",

      // Story-based (10)
      "Dear {title} {lastName},\n\nMy family has benefited from science-based health policy for generations. The vaccines my children received, the clean water we drink — all protected by evidence-based legislation.\n\n{billNumber} ({billTitle}) threatens that. Please oppose this bill and keep {state} families safe.\n\n{name}\n{city}, {state}",

      "Dear {title} {lastName},\n\nAs a nurse, I've seen firsthand what happens when public health protections are weakened. {billNumber} ({billTitle}) would take us backward.\n\nPlease oppose this bill. Healthcare workers in your district are counting on you.\n\n{name}\n{city}, {state}",

      "Dear {title} {lastName},\n\nI teach science to high schoolers in {city}. When bills like {billNumber} ({billTitle}) come up, my students ask me: \"Do our leaders not believe in science?\" I want to tell them yes, they do.\n\nPlease help me give them that answer. Oppose {billNumber}.\n\n{name}\n{city}, {state}",

      "Dear {title} {lastName},\n\nWhen I was growing up, a family member got seriously ill because they listened to misinformation instead of their doctor. I don't want that to happen to anyone in {state}.\n\n{billNumber} ({billTitle}) would make it easier for misinformation to win. Please vote NO.\n\n{name}\n{city}, {state}",

      "Dear {title} {lastName},\n\nDuring the last public health emergency, I watched my community come together to follow the science. It worked — we protected each other.\n\n{billNumber} ({billTitle}) would undermine that kind of collective action. Please oppose it.\n\n{name}\n{city}, {state}",

      "Dear {title} {lastName},\n\nI'm a pharmacist in {city}. Every day I counsel patients based on the best available evidence. {billNumber} ({billTitle}) would undermine the evidence-based framework that keeps my patients safe.\n\nPlease vote NO.\n\n{name}\n{city}, {state}",

      "Dear {title} {lastName},\n\nMy child has a condition that requires medical care based on the latest science. Bills like {billNumber} ({billTitle}) scare me, because they could weaken the protections my family depends on.\n\nPlease oppose this bill for families like mine.\n\n{name}\n{city}, {state}",

      "Dear {title} {lastName},\n\nI volunteer at a community health clinic in {city}. The people I serve are the ones who would be hurt most by {billNumber} ({billTitle}).\n\nPlease stand with them and oppose this anti-science legislation.\n\n{name}\n{city}, {state}",

      "Dear {title} {lastName},\n\nI'm a researcher in {state}. My career is dedicated to advancing scientific knowledge. {billNumber} ({billTitle}) would undermine the very evidence my colleagues and I work to produce.\n\nPlease oppose this bill and support the scientific community.\n\n{name}\n{city}, {state}",

      "Dear {title} {lastName},\n\nI became a public health advocate after losing someone close to me to a preventable disease. That experience taught me how important evidence-based policy is.\n\n{billNumber} ({billTitle}) moves us in the wrong direction. Please vote NO.\n\n{name}\n{city}, {state}"
    ]
  },

  // ────────────────────────────────────────────
  // CANDIDATE TEMPLATES
  // ────────────────────────────────────────────

  candidate: {
    subjects: [
      "Will you take the SAFE Action science pledge?",
      "A constituent's request: commit to evidence-based policy",
      "Where do you stand on science and public health?",
      "Will you champion science-based health policy?",
      "Can voters count on you for evidence-based policy?",
      "Take the SAFE Action pledge — show voters you trust science",
      "Voters want to know: do you stand for science?",
      "Will you commit to science-first policymaking?",
      "The SAFE Action pledge — voters are watching",
      "A question about your stance on science policy",
      "Science matters to voters in {city}, {state}",
      "Will you be a science champion if elected?",
      "Requesting your commitment to evidence-based governance",
      "As a voter, I need to know: where do you stand on science?",
      "Will you pledge to protect public health in {state}?",
      "Evidence-based policy: will you commit?",
      "Voters in {city} care about science — do you?",
      "The SAFE Action pledge: a chance to lead on science",
      "Your science stance matters to constituents",
      "Can we trust you to stand for evidence-based policy?",
      "A {city} voter asking about your science commitment",
      "Will you take a stand for public health?",
      "Science-based policy: a voter's request",
      "Show your commitment to science — take the pledge",
      "Voters are looking for pro-science candidates"
    ],

    bodies: [
      "Dear Candidate,\n\nAs a voter in {city}, {state}, I am paying close attention to candidates' positions on science and public health.\n\nI'm writing to ask if you would consider taking the SAFE Action pledge — a commitment to support evidence-based health policy if elected. Voters like me want to know that our future representatives will prioritize science.\n\nLearn more: {pledgeUrl}\n\nThank you for your time.\n\n{name}\n{city}, {state}",

      "Hello,\n\nI'm {name}, a voter in {city}. As you campaign for office, I want you to know that science-based public health policy is a top priority for me.\n\nThe SAFE Action pledge is a way to show voters that you're committed to evidence-based governance. I hope you'll take it: {pledgeUrl}\n\nGood luck on the trail!\n\n{name}",

      "Dear Candidate,\n\nI vote in every election, and one thing I always look for is a candidate's commitment to science. The SAFE Action pledge is a meaningful way to demonstrate that commitment.\n\nWill you take it? {pledgeUrl}\n\n{name}\n{city}, {state}",

      "Hi there,\n\nI'm a voter in your district and I care about evidence-based health policy. The SAFE Action pledge would tell voters like me that you're serious about science.\n\n{pledgeUrl}\n\nI hope to see your name on the list!\n\n{name}\n{city}",

      "Dear Candidate,\n\nIn a time of widespread health misinformation, {state} needs elected officials who will stand for science. The SAFE Action pledge is your chance to make that commitment clear to voters.\n\n{pledgeUrl}\n\nI look forward to your response.\n\n{name}\n{city}, {state}",

      "Hello,\n\nAs a constituent, I'm reaching out to candidates who I believe could be champions for science and evidence-based policy.\n\nThe SAFE Action pledge is a public commitment to prioritize scientific evidence in health policy decisions. I'd be proud to support a candidate who takes it.\n\n{pledgeUrl}\n\nBest,\n{name}\n{city}, {state}",

      "Dear Candidate,\n\nVoters are watching. We want leaders who trust science. The SAFE Action pledge is a clear, simple commitment to evidence-based health policy.\n\nWill you take it? {pledgeUrl}\n\n{name}\n{city}, {state}",

      "Hi,\n\nI'm a voter who makes decisions based on candidates' commitment to science. If you take the SAFE Action pledge, you'll have my attention — and my support.\n\n{pledgeUrl}\n\nLooking forward to hearing from you.\n\n{name}\n{city}",

      "Dear Candidate,\n\nRunning for office is about showing voters who you are. Taking the SAFE Action pledge shows that you believe in evidence-based policy — something a lot of us care about.\n\n{pledgeUrl}\n\nThank you for considering it.\n\n{name}\n{city}, {state}",

      "Dear Candidate,\n\nOur state needs pro-science leaders now more than ever. Anti-science legislation is advancing, and voters need to know where you stand.\n\nPlease take the SAFE Action pledge and commit to evidence-based health policy: {pledgeUrl}\n\nYour commitment matters.\n\n{name}\n{city}, {state}"
    ]
  }
};
