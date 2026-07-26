#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const VOCAB_PATH = path.join(ROOT, 'data', 'vocab.json');
const BATCH = 'phrase_curation_20260726';
const EXPECTED_WORD_COUNT = 4815;
const EXPECTED_SOURCE_HASH = '48d006954dfb4dcf614aca5384dc68ae';
const HASH_FIELDS = [
  'id', 'zh', 'ro', 'ipa', 'hint', 'cat', 'level', 'difficulty',
  'example_ro', 'example_zh', 'topic', 'part_of_speech', 'unit_type',
  'cefr', 'register', 'verification_status', 'source'
];

const WORD_IDS = new Set([6159, 6161, 5507, 5509, 6187]);
const SENTENCE_PATTERN_IDS = new Set([
  6170, 6171, 6172, 6173, 6174, 6175, 6176, 6177, 6178,
  6179, 6180, 6181, 6182, 6183, 6184, 6185, 6186, 7167, 7344
]);
const VERB_PHRASE_IDS = new Set([
  5669, 6345, 6405, 6455, 6457, 6464, 6513, 6556, 6557, 6588,
  6589, 6590, 6594, 6614, 6618, 6627, 6638, 6998, 7016, 7053,
  7065, 7121, 7130, 7150, 7152, 7256, 7264, 7277, 7278, 7328,
  8101, 8435
]);
const CORE_IDS = new Set([
  5463, 5464, 5470, 5471, 5474, 5477, 5483, 5487, 5512,
  5669, 6155, 6156, 6157, 6158, 6160, 6162, 6163, 6164, 6165,
  6170, 6171, 6172, 6173, 6174, 6175, 6176, 6177, 6178,
  6179, 6180, 6181, 6182, 6183, 6184, 6185, 6186,
  6345, 6405, 6455, 6457, 6464, 6513, 6556, 6557, 6588,
  6589, 6590, 6594, 6614, 6618, 6627, 6638, 6869, 6894,
  6896, 6906, 6998, 7016, 7044, 7053, 7065, 7121, 7130,
  7150, 7152, 7214, 7256, 7264, 7277, 7278, 7328, 7861,
  7928, 7990, 8059, 8063, 8070, 8073, 8101, 8177, 8178,
  8332, 8442, 8566, 8586
]);

const OVERRIDES = {
  5490: {
    ro: 'a da banii înapoi',
    ipa: 'a da bAnii înapOi',
    example_ro: 'Îți dau banii înapoi mâine.',
    example_zh: '我明天把钱还给你。',
    unit_type: 'verb_phrase',
    cefr: 'A2'
  },
  5723: {
    zh: '向左；在左边',
    example_ro: 'Farmacia este la stânga, lângă bancă.',
    example_zh: '药店在左边，银行旁边。',
    cefr: 'A1'
  },
  5724: {
    zh: '向右；在右边',
    example_ro: 'La intersecție, mergeți la dreapta.',
    example_zh: '到路口向右走。',
    cefr: 'A1'
  },
  6010: {
    ro: 'a avea ore',
    ipa: 'a aveA Ore',
    example_ro: 'Astăzi am ore până la trei.',
    example_zh: '我今天上课到三点。',
    cefr: 'A2'
  },
  6013: {
    zh: '毕业；完成学业',
    example_ro: 'A terminat școala anul trecut și acum lucrează.',
    example_zh: '他去年毕业，现在已经工作了。',
    cefr: 'A2'
  },
  6156: {
    zh: '您好；日间问候',
    example_ro: 'Bună ziua! Cu ce vă pot ajuta?',
    example_zh: '您好！有什么可以帮您？',
    cefr: 'A1'
  },
  6172: {
    ro: 'Puteți repeta, vă rog?',
    zh: '请您再说一遍好吗？',
    ipa: 'PutEți repetA, vă rog?',
    example_ro: 'Puteți repeta adresa, vă rog?',
    example_zh: '请您把地址再说一遍好吗？',
    unit_type: 'sentence_pattern',
    part_of_speech: 'expression',
    cefr: 'A1'
  },
  6173: {
    ro: 'Vorbiți mai încet, vă rog.',
    zh: '请说慢一点。',
    ipa: 'VorbIți mai încEt, vă rog.',
    example_ro: 'Vorbiți mai încet, vă rog. Încă învăț româna.',
    example_zh: '请说慢一点，我还在学罗马尼亚语。',
    unit_type: 'sentence_pattern',
    part_of_speech: 'expression',
    cefr: 'A1'
  },
  6177: {
    ro: 'Vorbiți engleză?',
    zh: '您会说英语吗？',
    ipa: 'VorbIți englEză?',
    example_ro: 'Scuzați-mă, vorbiți engleză?',
    example_zh: '不好意思，您会说英语吗？',
    unit_type: 'sentence_pattern',
    part_of_speech: 'expression',
    cefr: 'A1'
  },
  6183: {
    ro: 'Am ... ani.',
    zh: '我……岁。',
    ipa: 'Am ... ani.',
    example_ro: 'Am douăzeci și opt de ani.',
    example_zh: '我二十八岁。',
    unit_type: 'sentence_pattern',
    part_of_speech: 'expression',
    cefr: 'A1'
  },
  6184: {
    ro: 'Încântat(ă) de cunoștință.',
    zh: '很高兴认识您。',
    ipa: 'ÎncântAt(ă) de cunoștInță.',
    example_ro: 'Încântată de cunoștință, eu sunt Ana.',
    example_zh: '很高兴认识您，我叫Ana。',
    unit_type: 'sentence_pattern',
    part_of_speech: 'expression',
    cefr: 'A1'
  },
  6334: {
    ro: 'a pune în ghips',
    ipa: 'a pUne în ghIps',
    example_ro: 'Medicul i-a pus brațul în ghips.',
    example_zh: '医生给他的手臂打了石膏。',
    cefr: 'B1'
  },
  6344: {
    ro: 'a-și satisface stagiul militar',
    ipa: 'a-și satisfAce stAgiul militAr',
    example_ro: 'Și-a satisfăcut stagiul militar înainte de facultate.',
    example_zh: '他上大学前服完了兵役。',
    register: 'formal',
    cefr: 'B2'
  },
  6348: {
    ro: 'a da onorul',
    ipa: 'a da onOrul',
    example_ro: 'Soldatul a dat onorul în fața drapelului.',
    example_zh: '士兵在国旗前敬礼。',
    register: 'formal',
    cefr: 'B1'
  },
  6361: {
    ro: 'a avea o ședință',
    ipa: 'a aveA o ședInță',
    example_ro: 'Avem o ședință scurtă despre buget.',
    example_zh: '我们要开一个关于预算的短会。',
    cefr: 'A2'
  },
  6362: {
    ro: 'a întocmi un raport',
    zh: '编写报告',
    ipa: 'a întocmI un rapOrt',
    example_ro: 'Am întocmit un raport pe baza datelor din trimestrul trecut.',
    example_zh: '我根据上季度的数据编写了一份报告。',
    register: 'formal',
    cefr: 'B2'
  },
  6392: {
    ro: 'a face o rezervare la restaurant',
    zh: '预订餐厅座位',
    ipa: 'a fAce o rezervAre la restaurAnt',
    example_ro: 'Am făcut o rezervare la restaurant pentru ora șapte.',
    example_zh: '我预订了餐厅七点的座位。',
    cefr: 'A2'
  },
  6613: {
    ro: 'a schimba câteva vorbe',
    zh: '寒暄几句',
    ipa: 'a schimbA câtevA vOrbe',
    example_ro: 'Am schimbat câteva vorbe cu vecinii înainte să plec.',
    example_zh: '出门前我和邻居寒暄了几句。',
    unit_type: 'verb_phrase',
    cefr: 'B1'
  },
  6703: {
    zh: '做演示；作报告',
    example_ro: 'Mâine susțin o prezentare despre rezultatele proiectului.',
    example_zh: '明天我要做一个关于项目成果的演示。',
    cefr: 'B1'
  },
  6779: {
    ro: 'a face un vaccin',
    ipa: 'a fAce un vaccIn',
    example_ro: 'Copilul a făcut un vaccin înainte de începerea școlii.',
    example_zh: '孩子在开学前打了一针疫苗。',
    cefr: 'A2'
  },
  6789: {
    ro: 'a se menține sănătos',
    ipa: 'a se mențIne sănătOs',
    example_ro: 'Face mișcare regulat ca să se mențină sănătos.',
    example_zh: '他经常运动以保持健康。',
    cefr: 'A2'
  },
  6849: {
    ro: 'a se muta în noua locuință',
    zh: '搬进新居',
    ipa: 'a se mutA în nOua locuInță',
    example_ro: 'Ne mutăm în noua locuință sâmbătă.',
    example_zh: '我们星期六搬进新居。',
    cefr: 'A2'
  },
  6850: {
    ro: 'a se muta din locuință',
    zh: '从住处搬走',
    ipa: 'a se mutA din locuInță',
    example_ro: 'S-a mutat din locuință la sfârșitul lunii.',
    example_zh: '他在月底从住处搬走了。',
    cefr: 'A2'
  },
  6856: {
    ro: 'a pune un covor',
    ipa: 'a pUne un covOr',
    example_ro: 'Am pus un covor moale în sufragerie.',
    example_zh: '我们在客厅铺了一张柔软的地毯。',
    cefr: 'A2'
  },
  7019: {
    ro: 'a rezolva niște acte',
    zh: '办理一些手续',
    ipa: 'a rezolvA nIște Acte',
    example_ro: 'Merg la primărie să rezolv niște acte.',
    example_zh: '我去市政厅办理一些手续。',
    cefr: 'B1'
  },
  7020: {
    ro: 'a ura cuiva „La mulți ani!”',
    zh: '祝某人生日快乐',
    ipa: 'a urA cuivA „La mulți ani!”',
    example_ro: 'I-am urat „La mulți ani!” imediat după miezul nopții.',
    example_zh: '刚过午夜我就祝他生日快乐。',
    cefr: 'A2'
  },
  7031: {
    ro: 'a suna la ușă',
    zh: '按门铃',
    ipa: 'a sunA la Ușă',
    example_ro: 'Curierul a sunat la ușă.',
    example_zh: '快递员按了门铃。',
    cefr: 'A2'
  },
  7045: {
    zh: '收到退款',
    example_ro: 'Am primit rambursarea în trei zile.',
    example_zh: '我三天内收到了退款。',
    cefr: 'B1'
  },
  7068: {
    ro: 'a conduce oaspeții până la ușă',
    zh: '把客人送到门口',
    ipa: 'a condUce oaspEții pÂnă la Ușă',
    example_ro: 'I-am condus pe oaspeți până la ușă.',
    example_zh: '我把客人送到了门口。',
    cefr: 'B1'
  },
  7096: {
    zh: '在吃饭；在餐桌旁',
    example_ro: 'Suntem la masă; te sun mai târziu.',
    example_zh: '我们正在吃饭，晚点给你打电话。',
    cefr: 'A1'
  },
  7158: {
    zh: '上茶；端茶',
    example_ro: 'Gazda le-a servit ceai musafirilor.',
    example_zh: '主人给客人上了茶。',
    cefr: 'A2'
  },
  7167: {
    ro: 'Aș vrea fără sare, vă rog.',
    zh: '请不要加盐。',
    ipa: 'Aș vreA fĂră sAre, vă rog.',
    example_ro: 'Aș vrea supa fără sare, vă rog.',
    example_zh: '汤请不要加盐。',
    unit_type: 'sentence_pattern',
    part_of_speech: 'expression',
    cefr: 'A2'
  },
  7191: {
    zh: '再点一杯饮料',
    example_ro: 'Am mai cerut o băutură pentru prietenul meu.',
    example_zh: '我又给朋友点了一杯饮料。',
    cefr: 'A2'
  },
  7254: {
    ro: 'a plăti în numerar',
    zh: '用现金支付',
    ipa: 'a plătI în numerAr',
    example_ro: 'Prefer să plătesc în numerar.',
    example_zh: '我更喜欢用现金支付。',
    cefr: 'A2'
  },
  7274: {
    ro: 'a spăla rufele',
    ipa: 'a spălA rUfele',
    example_ro: 'Spăl rufele în fiecare sâmbătă.',
    example_zh: '我每周六洗衣服。',
    cefr: 'A1'
  },
  7327: {
    ro: 'a lua copilul de la școală',
    zh: '去学校接孩子',
    ipa: 'a luA copIlul de la școAlă',
    example_ro: 'Îl iau pe copil de la școală la ora patru.',
    example_zh: '我四点去学校接孩子。',
    cefr: 'A2'
  },
  7339: {
    ro: 'a scrie adresa pe colet',
    zh: '在包裹上写地址',
    ipa: 'a scrIe adrEsa pe colEt',
    example_ro: 'Scrie adresa clar pe colet.',
    example_zh: '请把地址清楚地写在包裹上。',
    cefr: 'A2'
  },
  7344: {
    ro: 'Aș vrea să fie mai puțin picant.',
    zh: '我想要少辣一点。',
    ipa: 'Aș vreA să fIe mai puțIn picAnt.',
    example_ro: 'Aș vrea sosul să fie mai puțin picant.',
    example_zh: '我希望酱汁少辣一点。',
    unit_type: 'sentence_pattern',
    part_of_speech: 'expression',
    cefr: 'A2'
  },
  7345: {
    ro: 'a aștepta să se facă verde',
    zh: '等绿灯亮',
    ipa: 'a așteptA să se fAcă vErde',
    example_ro: 'Așteptăm să se facă verde înainte să traversăm.',
    example_zh: '过马路前我们等绿灯亮。',
    cefr: 'A2'
  },
  7346: {
    ro: 'a încerca produsul',
    zh: '试用产品',
    ipa: 'a încercA prodUsul',
    example_ro: 'Aș vrea să încerc produsul înainte să-l cumpăr.',
    example_zh: '购买前我想先试用一下这个产品。',
    cefr: 'A2'
  },
  7397: {
    ro: 'a pune hainele la uscat',
    zh: '把衣服晾起来',
    ipa: 'a pUne hAinele la uscAt',
    example_ro: 'Am pus hainele la uscat pe balcon.',
    example_zh: '我把衣服晾在了阳台上。',
    cefr: 'A2'
  },
  7829: {
    ro: 'a fertiliza plantele',
    ipa: 'a fertilizA plAntele',
    example_ro: 'Fertilizez plantele o dată pe lună.',
    example_zh: '我每月给植物施肥一次。',
    cefr: 'A2'
  },
  7854: {
    ro: 'a muta planta la umbră',
    zh: '把植物移到阴处',
    ipa: 'a mutA plAnta la Umbră',
    example_ro: 'Mut planta la umbră când soarele este prea puternic.',
    example_zh: '阳光太强时我把植物移到阴处。',
    cefr: 'A2'
  },
  7934: {
    ro: 'a fixa copilul în scaunul auto',
    zh: '把孩子固定在安全座椅上',
    ipa: 'a fixA copIlul în scaUnul Auto',
    example_ro: 'Fixez copilul în scaunul auto înainte să pornim.',
    example_zh: '出发前我把孩子固定在安全座椅上。',
    cefr: 'A2'
  },
  7940: {
    ro: 'a refuza permisiunea pentru notificări',
    zh: '拒绝通知权限',
    ipa: 'a refuzA permisiUnea pEntru notificĂri',
    example_ro: 'Am refuzat permisiunea pentru notificări.',
    example_zh: '我拒绝了通知权限。',
    register: 'technical',
    cefr: 'B1'
  },
  7951: {
    ro: 'a face o programare la frizer',
    ipa: 'a fAce o programAre la frizEr',
    example_ro: 'Mi-am făcut o programare la frizer pentru vineri.',
    example_zh: '我预约了周五去理发。',
    cefr: 'A2'
  },
  7962: {
    ro: 'a face un puzzle',
    ipa: 'a fAce un pUzzle',
    example_ro: 'Facem un puzzle împreună în seara asta.',
    example_zh: '今晚我们一起拼拼图。',
    cefr: 'A2'
  },
  8046: {
    ro: 'a gusta mâncarea',
    zh: '尝一下食物的味道',
    ipa: 'a gustA mâncArea',
    example_ro: 'Gust mâncarea înainte să mai adaug sare.',
    example_zh: '再加盐之前我先尝一下味道。',
    cefr: 'A2'
  },
  8052: {
    ro: 'a verifica termenul de valabilitate',
    zh: '检查保质期',
    ipa: 'a verificA tErmenul de valabilitAte',
    example_ro: 'Verific termenul de valabilitate înainte să cumpăr iaurt.',
    example_zh: '买酸奶前我检查保质期。',
    cefr: 'B1'
  },
  8054: {
    ro: 'a reface proviziile',
    zh: '补充储备',
    ipa: 'a refAce provIziile',
    example_ro: 'Refacem proviziile înainte de weekend.',
    example_zh: '周末前我们把日用品补齐。',
    cefr: 'B1'
  },
  8057: {
    ro: 'a căuta produsul pe raft',
    zh: '在货架上找商品',
    ipa: 'a căutA prodUsul pe raft',
    example_ro: 'Am căutat produsul pe raft, dar nu l-am găsit.',
    example_zh: '我在货架上找了这个商品，但没找到。',
    cefr: 'A2'
  },
  8072: {
    ro: 'a fixa scaunul auto pentru copil',
    zh: '安装儿童安全座椅',
    ipa: 'a fixA scaUnul Auto pEntru copIl',
    example_ro: 'Am fixat scaunul auto pentru copil pe bancheta din spate.',
    example_zh: '我把儿童安全座椅固定在了后排。',
    cefr: 'B1'
  },
  8092: {
    ro: 'a accepta termenii și condițiile',
    zh: '同意条款和条件',
    ipa: 'a acceptA tErmenii și condIțiile',
    example_ro: 'Trebuie să accepți termenii și condițiile înainte să continui.',
    example_zh: '继续之前需要同意条款和条件。',
    register: 'technical',
    cefr: 'B1'
  },
  8155: {
    ro: 'a solicita un card de fidelitate',
    zh: '申请会员卡',
    ipa: 'a solicitA un card de fidelitAte',
    example_ro: 'Am solicitat un card de fidelitate la casă.',
    example_zh: '我在收银台申请了一张会员卡。',
    cefr: 'B1'
  },
  8167: {
    ro: 'a lipi eticheta cu prețul',
    zh: '贴价格标签',
    ipa: 'a lipI etichEta cu prEțul',
    example_ro: 'Angajatul a lipit eticheta cu prețul pe cutie.',
    example_zh: '员工把价格标签贴在了盒子上。',
    cefr: 'A2'
  },
  8371: {
    ro: 'a declara pierderea unui obiect',
    zh: '申报物品遗失',
    ipa: 'a declarA piErderea Unui obiEct',
    example_ro: 'Am declarat pierderea telefonului la biroul de informații.',
    example_zh: '我在服务台申报了手机遗失。',
    register: 'formal',
    cefr: 'B1'
  },
  8374: {
    zh: '服用糖浆',
    example_ro: 'Iau siropul după masă.',
    example_zh: '我饭后服用糖浆。',
    cefr: 'A2'
  },
  8405: {
    ro: 'a trimite un mesaj de mulțumire',
    zh: '发送感谢信息',
    ipa: 'a trimIte un mesAj de mulțumIre',
    example_ro: 'Le-am trimis un mesaj de mulțumire după petrecere.',
    example_zh: '聚会后我给他们发了一条感谢信息。',
    cefr: 'B1'
  },
  8429: {
    ro: 'a cere decontarea cheltuielilor',
    zh: '申请费用报销',
    ipa: 'a cEre decontArea cheltuiElilor',
    example_ro: 'Am cerut decontarea cheltuielilor de transport.',
    example_zh: '我申请报销交通费。',
    register: 'formal',
    cefr: 'B2'
  },
  8431: {
    zh: '擦眼镜',
    example_ro: 'Îmi curăț ochelarii cu o lavetă moale.',
    example_zh: '我用柔软的眼镜布擦眼镜。',
    cefr: 'A2'
  },
  8442: {
    zh: '眼下；暂时',
    example_ro: 'Pe moment, nu avem alte informații.',
    example_zh: '眼下我们没有其他信息。',
    cefr: 'B1'
  },
  8448: {
    ro: 'a face o programare la ghișeu',
    zh: '预约柜台业务',
    ipa: 'a fAce o programAre la ghișEu',
    example_ro: 'Am făcut o programare la ghișeu pentru luni.',
    example_zh: '我预约了周一去柜台办理业务。',
    register: 'formal',
    cefr: 'B1'
  },
  8501: {
    ro: 'a solicita reparația în garanție',
    zh: '申请保修',
    ipa: 'a solicitA reparAția în garAnție',
    example_ro: 'Am solicitat reparația telefonului în garanție.',
    example_zh: '我申请在保修期内维修手机。',
    register: 'formal',
    cefr: 'B2'
  },
  8549: {
    ro: 'a umple sticla cu apă',
    zh: '把水瓶装满水',
    ipa: 'a Umple stIcla cu Apă',
    example_ro: 'Umplu sticla cu apă înainte de drum.',
    example_zh: '出门前我把水瓶装满水。',
    cefr: 'A2'
  },
  8564: {
    ro: 'a trece de controlul de securitate',
    zh: '通过安检',
    ipa: 'a trEce de contrOlul de securitAte',
    example_ro: 'Am trecut de controlul de securitate în zece minute.',
    example_zh: '我们十分钟内通过了安检。',
    cefr: 'B1'
  },
  8567: {
    ro: 'a rezerva un loc',
    zh: '预订座位',
    ipa: 'a rezervA un loc',
    example_ro: 'Am rezervat un loc lângă fereastră.',
    example_zh: '我预订了一个靠窗的座位。',
    cefr: 'A2'
  },
  8593: {
    ro: 'a trimite certificatul medical',
    zh: '提交病假证明',
    ipa: 'a trimIte certificAtul medicAl',
    example_ro: 'Am trimis certificatul medical la resurse umane.',
    example_zh: '我把病假证明发给了人力资源部门。',
    register: 'formal',
    cefr: 'B1'
  },
  8626: {
    zh: '在中间',
    example_ro: 'Masa este la mijlocul camerei.',
    example_zh: '桌子在房间中间。',
    cefr: 'A1'
  },
  8630: {
    zh: '在房子前面',
    example_ro: 'Mașina este parcată în fața casei.',
    example_zh: '车停在房子前面。',
    cefr: 'A1'
  }
};

const ADDITIONS = [
  ['我想要……', 'Aș dori...', 'Aș dorI...', '礼貌提出需求', 'Aș dori o cafea, vă rog.', '我想要一杯咖啡。', 'sentence_pattern', 'A2', 'neutral'],
  ['我想……', 'Aș vrea...', 'Aș vreA...', '日常提出愿望或请求', 'Aș vrea să rezerv o masă pentru două persoane.', '我想订一张两人桌。', 'sentence_pattern', 'A2', 'neutral'],
  ['我很想……', 'Mi-ar plăcea să...', 'Mi-ar plăceA să...', '委婉表达愿望', 'Mi-ar plăcea să vorbesc mai bine românește.', '我很想把罗马尼亚语说得更好。', 'sentence_pattern', 'B1', 'neutral'],
  ['您能帮帮我吗？', 'Puteți să mă ajutați?', 'PutEți să mă ajutAți?', '礼貌求助', 'Puteți să mă ajutați cu formularul acesta?', '您能帮我填一下这张表吗？', 'sentence_pattern', 'A2', 'neutral'],
  ['没关系。', 'Nu-i nicio problemă.', 'Nu-i nIcio problEmă.', '安慰和接受道歉', 'Nu-i nicio problemă, putem încerca din nou.', '没关系，我们可以再试一次。', 'expression', 'A2', 'informal'],
  ['别担心。', 'Nu-ți face griji.', 'Nu-ți fAce grIji.', '安慰对方', 'Nu-ți face griji, mă ocup eu.', '别担心，我来处理。', 'expression', 'A2', 'informal'],
  ['我没听懂。', 'Nu am înțeles.', 'Nu am înțelEs.', '说明没有理解', 'Nu am înțeles ultima parte.', '最后一部分我没听懂。', 'sentence_pattern', 'A1', 'neutral'],
  ['请再说一遍。', 'Repetați, vă rog.', 'RepetAți, vă rog.', '请求重复', 'Repetați numărul, vă rog.', '请把号码再说一遍。', 'sentence_pattern', 'A1', 'neutral'],
  ['……是什么意思？', 'Ce înseamnă...?', 'Ce înseAmnă...?', '询问含义', 'Ce înseamnă cuvântul acesta?', '这个词是什么意思？', 'sentence_pattern', 'A1', 'neutral'],
  ['……怎么发音？', 'Cum se pronunță...?', 'Cum se pronUnță...?', '询问发音', 'Cum se pronunță numele dumneavoastră?', '您的名字怎么发音？', 'sentence_pattern', 'A2', 'neutral'],
  ['我觉得……', 'Mi se pare că...', 'Mi se pAre că...', '表达看法', 'Mi se pare că soluția aceasta este mai simplă.', '我觉得这个办法更简单。', 'sentence_pattern', 'B1', 'neutral'],
  ['从我的角度看，……', 'Din punctul meu de vedere,...', 'Din pUnctul meu de vedEre,...', '明确表达观点', 'Din punctul meu de vedere, avem nevoie de mai mult timp.', '从我的角度看，我们需要更多时间。', 'sentence_pattern', 'B1', 'neutral'],
  ['你怎么看……？', 'Ce părere ai despre...?', 'Ce părEre ai dEspre...?', '询问意见', 'Ce părere ai despre propunerea lor?', '你怎么看他们的提议？', 'sentence_pattern', 'B1', 'neutral'],
  ['我同意……', 'Sunt de acord cu...', 'Sunt de acOrd cu...', '表示同意并带出对象', 'Sunt de acord cu ideea ta.', '我同意你的想法。', 'sentence_pattern', 'A2', 'neutral'],
  ['我不同意……', 'Nu sunt de acord cu...', 'Nu sunt de acOrd cu...', '表示不同意并带出对象', 'Nu sunt de acord cu această concluzie.', '我不同意这个结论。', 'sentence_pattern', 'A2', 'neutral'],
  ['这取决于……', 'Depinde de...', 'DepInde de...', '表达条件依赖', 'Depinde de cât timp avem.', '这取决于我们有多少时间。', 'sentence_pattern', 'B1', 'neutral'],
  ['其实，……', 'De fapt,...', 'De fApt,...', '纠正或补充信息', 'De fapt, întâlnirea este mâine, nu astăzi.', '其实会议是明天，不是今天。', 'expression', 'B1', 'neutral'],
  ['到头来；最终，……', 'Până la urmă,...', 'PÂnă la Urmă,...', '总结最终结果', 'Până la urmă, am găsit o soluție.', '到头来，我们还是找到了解决办法。', 'expression', 'B1', 'neutral'],
  ['无论如何，……', 'În orice caz,...', 'În Orice caz,...', '收束讨论或转折', 'În orice caz, trebuie să răspundem astăzi.', '无论如何，我们今天必须回复。', 'expression', 'B1', 'neutral'],
  ['说到……', 'Apropo de...', 'ApropO de...', '自然转换话题', 'Apropo de vacanță, ai rezervat biletele?', '说到假期，你订票了吗？', 'expression', 'B1', 'informal'],
  ['老实说，……', 'Ca să fiu sincer(ă),...', 'Ca să fiu sincEr(ă),...', '坦率表达看法', 'Ca să fiu sincer, nu mi se pare o idee bună.', '老实说，我觉得这不是个好主意。', 'sentence_pattern', 'B1', 'neutral'],
  ['如果我理解得没错，……', 'Dacă am înțeles bine,...', 'Dacă am înțelEs bIne,...', '确认理解', 'Dacă am înțeles bine, termenul este vineri.', '如果我理解得没错，截止日期是周五。', 'sentence_pattern', 'B1', 'neutral'],
  ['换句话说，……', 'Cu alte cuvinte,...', 'Cu Alte cuvInte,...', '换一种方式解释', 'Cu alte cuvinte, trebuie să începem de la zero.', '换句话说，我们得从头开始。', 'expression', 'B1', 'neutral'],
  ['有道理。', 'Are sens.', 'Are sEns.', '认可解释合理', 'Da, explicația ta are sens.', '对，你的解释有道理。', 'expression', 'B1', 'neutral'],
  ['说不通；没道理。', 'Nu are sens.', 'Nu Are sEns.', '指出逻辑不通', 'Nu are sens să așteptăm fără să întrebăm.', '我们什么都不问只是干等着，这没道理。', 'expression', 'B1', 'neutral'],
  ['考虑到……', 'a ține cont de...', 'a țIne cont de...', '作决定时纳入因素', 'Trebuie să ținem cont de buget.', '我们必须考虑预算。', 'verb_phrase', 'B1', 'neutral'],
  ['与……取得联系', 'a lua legătura cu...', 'a luA legătUra cu...', '主动联系某人或机构', 'Voi lua legătura cu serviciul clienți.', '我会联系客户服务。', 'verb_phrase', 'B1', 'neutral'],
  ['与……有关；打交道', 'a avea de-a face cu...', 'a aveA de-a fAce cu...', '说明关联或接触对象', 'Problema are de-a face cu ultima actualizare.', '这个问题与上次更新有关。', 'verb_phrase', 'B2', 'neutral'],
  ['负责；处理……', 'a se ocupa de...', 'a se ocupA de...', '说明职责或处理对象', 'Mă ocup eu de rezervare.', '预订的事我来处理。', 'verb_phrase', 'B1', 'neutral'],
  ['应对……', 'a face față...', 'a fAce fAță...', '应对困难或压力', 'Echipa a făcut față situației foarte bine.', '团队很好地应对了这种局面。', 'verb_phrase', 'B2', 'neutral'],
  ['意识到……', 'a-și da seama că...', 'a-și da seAma că...', '表达突然理解或意识', 'Mi-am dat seama că am uitat documentele.', '我意识到自己忘带文件了。', 'verb_phrase', 'B1', 'neutral'],
  ['需要……', 'a avea nevoie de...', 'a aveA nevOie de...', '表达需要并带出对象', 'Avem nevoie de mai multe informații.', '我们需要更多信息。', 'verb_phrase', 'A2', 'neutral'],
  ['是对的；有道理', 'a avea dreptate', 'a aveA dreptAte', '承认判断正确', 'Ai dreptate, am calculat greșit.', '你说得对，是我算错了。', 'verb_phrase', 'A2', 'neutral'],
  ['说的是；涉及……', 'a fi vorba despre...', 'a fi vOrba dEspre...', '引出正在讨论的主题', 'Este vorba despre o schimbare importantă.', '这里说的是一项重要变化。', 'verb_phrase', 'B1', 'neutral'],
  ['安排妥当；完善……', 'a pune la punct...', 'a pUne la pUnct...', '把计划或系统准备完善', 'Trebuie să punem la punct toate detaliile.', '我们得把所有细节安排妥当。', 'verb_phrase', 'B2', 'neutral'],
  ['得出结论', 'a ajunge la o concluzie', 'a ajUnge la o conclUzie', '完成分析后形成判断', 'Am ajuns la aceeași concluzie.', '我们得出了相同的结论。', 'collocation', 'B1', 'neutral'],
  ['作出决定', 'a lua o decizie', 'a luA o decIzie', '常用决策搭配', 'Trebuie să luăm o decizie până mâine.', '我们必须在明天之前作出决定。', 'collocation', 'B1', 'neutral'],
  ['把……付诸实践', 'a pune în practică...', 'a pUne în prActică...', '把想法变成行动', 'Este timpul să punem planul în practică.', '该把计划付诸实践了。', 'verb_phrase', 'B2', 'neutral'],
  ['找到解决办法', 'a găsi o soluție', 'a găsI o solUție', '解决问题的高频搭配', 'Încercăm să găsim o soluție simplă.', '我们在努力寻找一个简单的解决办法。', 'collocation', 'B1', 'neutral'],
  ['把……考虑进去', 'a lua în considerare...', 'a luA în considerAre...', '正式讨论中的高频框架', 'Vom lua în considerare toate opțiunile.', '我们会考虑所有选项。', 'verb_phrase', 'B2', 'formal'],
  ['提起……这个话题', 'a aduce vorba despre...', 'a adUce vOrba dEspre...', '自然引出敏感或新话题', 'Nu știam cum să aduc vorba despre bani.', '我不知道该怎么提起钱的话题。', 'verb_phrase', 'B2', 'neutral'],
  ['保持联系', 'a rămâne în legătură', 'a rămÂne în legătUră', '结束交流时保持后续联系', 'Să rămânem în legătură după curs.', '课程结束后我们保持联系吧。', 'verb_phrase', 'B1', 'neutral'],
  ['没有意义；没必要', 'a nu avea rost', 'a nu aveA rost', '判断某事不值得做', 'Nu are rost să ne certăm acum.', '现在争吵没有意义。', 'verb_phrase', 'B1', 'neutral'],
  ['值得……', 'a merita să...', 'a meritA să...', '评价行动是否值得', 'Merită să încerci încă o dată.', '值得再试一次。', 'sentence_pattern', 'B1', 'neutral'],
  ['设定优先事项', 'a stabili o prioritate', 'a stabilI o prioritAte', '工作规划搭配', 'Trebuie să stabilim o prioritate clară.', '我们需要设定一个明确的优先事项。', 'collocation', 'B2', 'formal'],
  ['按时完成；遵守截止日期', 'a respecta un termen-limită', 'a respectA un tErmen-lImită', '职场期限表达', 'Echipa a respectat termenul-limită.', '团队按时完成了任务。', 'collocation', 'B2', 'formal'],
  ['随后答复', 'a reveni cu un răspuns', 'a revenI cu un răspUns', '暂不能答复时承诺跟进', 'Revin cu un răspuns până la sfârșitul zilei.', '我会在今天结束前给您答复。', 'verb_phrase', 'B2', 'formal'],
  ['澄清要求', 'a clarifica o cerință', 'a clarificA o cerInță', '工作沟通搭配', 'Aș vrea să clarific o cerință înainte să încep.', '开始之前我想澄清一个要求。', 'collocation', 'B2', 'formal'],
  ['跟进进展', 'a urmări progresul', 'a urmărI progrEsul', '项目协作搭配', 'Urmărim progresul în fiecare săptămână.', '我们每周跟进进展。', 'collocation', 'B1', 'neutral'],
  ['发言', 'a lua cuvântul', 'a luA cuvÂntul', '会议或公开场合发言', 'Directorul a luat cuvântul la finalul ședinței.', '经理在会议最后发了言。', 'verb_phrase', 'B2', 'formal'],
  ['达成一致', 'a ajunge la un acord', 'a ajUnge la un acOrd', '协商结果搭配', 'Am ajuns la un acord după două ore de discuții.', '讨论两小时后我们达成了一致。', 'collocation', 'B1', 'neutral'],
  ['提出一个问题', 'a pune o întrebare', 'a pUne o întrebAre', '比裸动词更自然的常用搭配', 'Pot să pun o întrebare?', '我可以问一个问题吗？', 'collocation', 'A2', 'neutral']
].map(([zh, ro, ipa, hint, example_ro, example_zh, unit_type, cefr, register]) => {
  const workPhrases = new Set([
    'a pune la punct...', 'a ajunge la o concluzie', 'a lua o decizie',
    'a pune în practică...', 'a găsi o soluție', 'a lua în considerare...',
    'a stabili o prioritate', 'a respecta un termen-limită',
    'a reveni cu un răspuns', 'a clarifica o cerință', 'a urmări progresul',
    'a lua cuvântul', 'a ajunge la un acord'
  ]);
  const peoplePhrases = new Set([
    'a lua legătura cu...', 'a aduce vorba despre...', 'a rămâne în legătură'
  ]);
  const topic = workPhrases.has(ro)
    ? 'work_management'
    : (peoplePhrases.has(ro) ? 'people_society' : 'daily_life');
  const isVerbUnit = unit_type === 'collocation' || unit_type === 'verb_phrase';
  return {
    zh, ro, ipa, hint, example_ro, example_zh, unit_type, cefr, register,
    cat: topic,
    topic,
    part_of_speech: isVerbUnit ? 'verb' : 'expression',
    level: cefr === 'A1' || cefr === 'A2' ? 'A1-A2' : 'B1-B2',
    difficulty: cefr === 'A1' || cefr === 'A2' ? 'beginner' : 'intermediate',
    verification_status: 'verified',
    source: BATCH,
    grammar_data: {
      part_of_speech: isVerbUnit ? 'verb' : 'expression',
      phrase_quality: 'core',
      phrase_function: hint,
      curation_batch: BATCH
    }
  };
});

function loadPayload() {
  return JSON.parse(fs.readFileSync(VOCAB_PATH, 'utf8'));
}

function contentHash(words) {
  const text = [...words]
    .sort((a, b) => Number(a.id) - Number(b.id))
    .map(word => HASH_FIELDS.map(field => word[field] ?? '').join('|'))
    .join('\n');
  return crypto.createHash('md5').update(text).digest('hex');
}

function defaultCefr(word) {
  if (word.topic === 'daily_life') return 'A2';
  if (word.topic === 'health_medicine' || word.topic === 'nature_agriculture') return 'A2';
  if (word.topic === 'philosophy_abstract') return 'B2';
  return 'B1';
}

function defaultRegister(word) {
  if ([3978, 3979, 4914, 6248, 6249].includes(Number(word.id))) return 'technical';
  if (['law_public_affairs', 'defense_security'].includes(word.topic)) return 'formal';
  if ([6869, 7952].includes(Number(word.id))) return 'colloquial';
  return 'neutral';
}

function targetUnitType(word, originalUnitType) {
  const id = Number(word.id);
  if (WORD_IDS.has(id)) return 'word';
  if (SENTENCE_PATTERN_IDS.has(id)) return 'sentence_pattern';
  if (VERB_PHRASE_IDS.has(id)) return 'verb_phrase';
  if (originalUnitType === 'expression') return 'expression';
  return 'collocation';
}

function transformExisting(words) {
  return words.map(word => {
    if (word.source === BATCH && Number(word.id) > 8703) return word;
    const originalUnitType = word.grammar_data?.original_unit_type || word.unit_type;
    const inCohort = ['verb_phrase', 'expression'].includes(originalUnitType) ||
      word.grammar_data?.curation_batch === BATCH;
    if (!inCohort) return word;

    const id = Number(word.id);
    const override = OVERRIDES[id] || {};
    const unitType = override.unit_type || targetUnitType(word, originalUnitType);
    const partOfSpeech = override.part_of_speech ||
      (WORD_IDS.has(id)
        ? (id === 6159 || id === 6161 ? 'interjection' : 'verb')
        : (unitType === 'sentence_pattern' ? 'expression' : word.part_of_speech));
    const phraseQuality = CORE_IDS.has(id) || unitType === 'sentence_pattern' ||
      override.unit_type === 'verb_phrase'
      ? 'core'
      : (originalUnitType === 'expression' ? 'supporting_expression' : 'natural_collocation');
    const changedContent = Object.keys(override).some(key =>
      ['ro', 'zh', 'ipa', 'hint', 'example_ro', 'example_zh'].includes(key)
    );

    return {
      ...word,
      ...override,
      part_of_speech: partOfSpeech,
      unit_type: unitType,
      cefr: override.cefr || word.cefr || defaultCefr(word),
      register: override.register || word.register || defaultRegister(word),
      verification_status: changedContent || phraseQuality === 'core'
        ? 'verified'
        : word.verification_status,
      source: changedContent ? BATCH : word.source,
      grammar_data: {
        ...(word.grammar_data || {}),
        original_unit_type: originalUnitType,
        part_of_speech: partOfSpeech,
        phrase_quality: phraseQuality,
        curation_batch: BATCH
      }
    };
  });
}

function assertPlan(payload, transformed) {
  const sourceWords = payload.words || [];
  const appliedRows = sourceWords.filter(word => word.grammar_data?.curation_batch === BATCH);
  const alreadyApplied = sourceWords.length === EXPECTED_WORD_COUNT + ADDITIONS.length &&
    appliedRows.length === 804 + ADDITIONS.length;
  if (sourceWords.length !== EXPECTED_WORD_COUNT && !alreadyApplied) {
    throw new Error(`Expected ${EXPECTED_WORD_COUNT} source words or a complete applied snapshot, found ${sourceWords.length}`);
  }
  const sourceHash = contentHash(sourceWords);
  if (!alreadyApplied && sourceHash !== EXPECTED_SOURCE_HASH) {
    throw new Error(`Unexpected source hash ${sourceHash}; expected ${EXPECTED_SOURCE_HASH}`);
  }
  const sourcePhraseCount = sourceWords.filter(word =>
    Number(word.id) <= 8703 && (
      ['verb_phrase', 'expression'].includes(word.unit_type) ||
      word.grammar_data?.curation_batch === BATCH
    )
  ).length;
  if (sourcePhraseCount !== 804) {
    throw new Error(`Expected 804 curated source rows, found ${sourcePhraseCount}`);
  }
  for (const id of Object.keys(OVERRIDES).map(Number)) {
    if (!sourceWords.some(word => Number(word.id) === id)) throw new Error(`Missing override target id ${id}`);
  }
  const keys = new Map();
  for (const word of transformed) {
    const key = String(word.ro || '').normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('ro');
    if (keys.has(key)) throw new Error(`Duplicate Romanian headword after curation: ${word.ro} (${keys.get(key)}, ${word.id})`);
    keys.set(key, word.id);
  }
  for (const addition of ADDITIONS) {
    const key = addition.ro.normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('ro');
    const existing = sourceWords.find(word =>
      String(word.ro || '').normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('ro') === key
    );
    if (keys.has(key) && !(alreadyApplied && existing?.source === BATCH && Number(existing.id) > 8703)) {
      throw new Error(`Addition already exists: ${addition.ro} (id ${keys.get(key)})`);
    }
    if (keys.get(`new:${key}`)) throw new Error(`Duplicate addition: ${addition.ro}`);
    keys.set(`new:${key}`, true);
  }
  return { alreadyApplied, sourceHash };
}

function sqlLiteral(value) {
  if (value === null || value === undefined) return 'NULL';
  return `'${String(value).replace(/'/g, "''")}'`;
}

function sqlJson(value) {
  return `${sqlLiteral(JSON.stringify(value))}::jsonb`;
}

function intArray(values) {
  return `ARRAY[${[...values].sort((a, b) => a - b).join(',')}]::integer[]`;
}

function buildSql(payload, transformed) {
  if (payload.words.some(word => word.source === BATCH && Number(word.id) > 8703)) {
    throw new Error(`${BATCH} has already been applied; refusing to generate a second cloud migration`);
  }
  const beforeById = new Map(payload.words.map(word => [Number(word.id), word]));
  const changedRows = transformed.filter(word => {
    const before = beforeById.get(Number(word.id));
    return JSON.stringify(before) !== JSON.stringify(word);
  });
  const overrideIds = new Set(Object.keys(OVERRIDES).map(Number));
  const overrideRows = transformed.filter(word => overrideIds.has(Number(word.id)));
  const overrideValues = overrideRows.map(word => `(
    ${Number(word.id)},
    ${sqlLiteral(word.zh)},
    ${sqlLiteral(word.ro)},
    ${sqlLiteral(word.ipa || '')},
    ${sqlLiteral(word.hint || '')},
    ${sqlLiteral(word.example_ro || '')},
    ${sqlLiteral(word.example_zh || '')},
    ${sqlLiteral(word.part_of_speech)},
    ${sqlLiteral(word.unit_type)},
    ${sqlJson(word.grammar_data || {})},
    ${sqlLiteral(word.cefr)},
    ${sqlLiteral(word.register)},
    ${sqlLiteral(word.verification_status)},
    ${sqlLiteral(word.source)}
  )`).join(',\n');
  const overrideCoreIds = new Set(
    Object.entries(OVERRIDES)
      .filter(([, override]) => override.unit_type === 'verb_phrase')
      .map(([id]) => Number(id))
  );
  const verifiedIds = new Set([
    ...CORE_IDS,
    ...SENTENCE_PATTERN_IDS,
    ...overrideIds
  ]);
  const additions = ADDITIONS.map(word => `(
    ${sqlLiteral(word.zh)}, ${sqlLiteral(word.ro)}, ${sqlLiteral(word.ipa)},
    ${sqlLiteral(word.hint)}, ${sqlLiteral(word.cat)}, ${sqlLiteral(word.level)},
    ${sqlLiteral(word.difficulty)}, ${sqlLiteral(word.example_ro)}, ${sqlLiteral(word.example_zh)},
    ${sqlLiteral(word.topic)}, ${sqlLiteral(word.part_of_speech)}, ${sqlLiteral(word.unit_type)},
    ${sqlJson(word.grammar_data)}, ${sqlLiteral(word.cefr)}, ${sqlLiteral(word.register)},
    ${sqlLiteral(word.verification_status)}, ${sqlLiteral(word.source)}
  )`).join(',\n');

  return `BEGIN;

DO $$
DECLARE
  current_count integer;
  current_hash text;
BEGIN
  SELECT count(*)::integer,
         md5(string_agg(concat_ws('|',
           coalesce(id::text,''), coalesce(zh,''), coalesce(ro,''),
           coalesce(ipa,''), coalesce(hint,''), coalesce(cat,''),
           coalesce(level,''), coalesce(difficulty,''), coalesce(example_ro,''),
           coalesce(example_zh,''), coalesce(topic,''), coalesce(part_of_speech,''),
           coalesce(unit_type,''), coalesce(cefr,''), coalesce(register,''),
           coalesce(verification_status,''), coalesce(source,'')
         ), E'\\n' ORDER BY id))
  INTO current_count, current_hash
  FROM public.words;
  IF current_count <> ${EXPECTED_WORD_COUNT} OR current_hash <> '${EXPECTED_SOURCE_HASH}' THEN
    RAISE EXCEPTION 'words snapshot changed: count %, hash %', current_count, current_hash;
  END IF;
END $$;

UPDATE public.words
SET unit_type = CASE
      WHEN id = ANY(${intArray(WORD_IDS)}) THEN 'word'
      WHEN id = ANY(${intArray(SENTENCE_PATTERN_IDS)}) THEN 'sentence_pattern'
      WHEN id = ANY(${intArray(VERB_PHRASE_IDS)}) THEN 'verb_phrase'
      ELSE CASE WHEN unit_type = 'expression' THEN 'expression' ELSE 'collocation' END
    END,
    part_of_speech = CASE
      WHEN id = ANY(ARRAY[6159,6161]::integer[]) THEN 'interjection'
      WHEN id = ANY(${intArray(WORD_IDS)}) THEN 'verb'
      WHEN id = ANY(${intArray(SENTENCE_PATTERN_IDS)}) THEN 'expression'
      ELSE part_of_speech
    END,
    cefr = COALESCE(cefr, CASE
      WHEN topic = 'daily_life' THEN 'A2'
      WHEN topic IN ('health_medicine', 'nature_agriculture') THEN 'A2'
      WHEN topic = 'philosophy_abstract' THEN 'B2'
      ELSE 'B1'
    END),
    register = COALESCE(register, CASE
      WHEN id = ANY(ARRAY[3978,3979,4914,6248,6249]::integer[]) THEN 'technical'
      WHEN topic IN ('law_public_affairs', 'defense_security') THEN 'formal'
      WHEN id = ANY(ARRAY[6869,7952]::integer[]) THEN 'colloquial'
      ELSE 'neutral'
    END),
    verification_status = CASE
      WHEN id = ANY(${intArray(verifiedIds)}) THEN 'verified'
      ELSE verification_status
    END,
    source = CASE
      WHEN id = ANY(${intArray(overrideIds)}) THEN '${BATCH}'
      ELSE source
    END,
    grammar_data = COALESCE(grammar_data, '{}'::jsonb) || jsonb_build_object(
      'original_unit_type', unit_type,
      'part_of_speech', CASE
        WHEN id = ANY(ARRAY[6159,6161]::integer[]) THEN 'interjection'
        WHEN id = ANY(${intArray(WORD_IDS)}) THEN 'verb'
        WHEN id = ANY(${intArray(SENTENCE_PATTERN_IDS)}) THEN 'expression'
        ELSE part_of_speech
      END,
      'phrase_quality', CASE
        WHEN id = ANY(${intArray(CORE_IDS)})
          OR id = ANY(${intArray(SENTENCE_PATTERN_IDS)})
          OR id = ANY(${intArray(overrideCoreIds)})
          THEN 'core'
        WHEN unit_type = 'expression' THEN 'supporting_expression'
        ELSE 'natural_collocation'
      END,
      'curation_batch', '${BATCH}'
    )
WHERE unit_type IN ('verb_phrase', 'expression');

WITH curated(
  id, zh, ro, ipa, hint, example_ro, example_zh, part_of_speech,
  unit_type, grammar_data, cefr, register, verification_status, source
) AS (
  VALUES
${overrideValues}
)
UPDATE public.words AS w
SET zh = c.zh,
    ro = c.ro,
    ipa = c.ipa,
    hint = c.hint,
    example_ro = c.example_ro,
    example_zh = c.example_zh,
    part_of_speech = c.part_of_speech,
    unit_type = c.unit_type,
    grammar_data = c.grammar_data,
    cefr = c.cefr,
    register = c.register,
    verification_status = c.verification_status,
    source = c.source
FROM curated AS c
WHERE w.id = c.id;

INSERT INTO public.words(
  zh, ro, ipa, hint, cat, level, difficulty, example_ro, example_zh,
  topic, part_of_speech, unit_type, grammar_data, cefr, register,
  verification_status, source
)
VALUES
${additions}
ON CONFLICT (ro) DO NOTHING;

DO $$
DECLARE
  curated_count integer;
  inserted_count integer;
BEGIN
  SELECT count(*)::integer INTO curated_count
  FROM public.words
  WHERE grammar_data->>'curation_batch' = '${BATCH}';
  SELECT count(*)::integer INTO inserted_count
  FROM public.words
  WHERE source = '${BATCH}' AND id > 8703;
  IF curated_count <> ${changedRows.length + ADDITIONS.length} THEN
    RAISE EXCEPTION 'unexpected curated row count: %', curated_count;
  END IF;
  IF inserted_count <> ${ADDITIONS.length} THEN
    RAISE EXCEPTION 'unexpected inserted phrase count: %', inserted_count;
  END IF;
END $$;

COMMIT;

SELECT
  count(*)::integer AS total_words,
  count(*) FILTER (WHERE grammar_data->>'curation_batch' = '${BATCH}')::integer AS curated_rows,
  count(*) FILTER (WHERE grammar_data->>'phrase_quality' = 'core')::integer AS core_phrases,
  count(*) FILTER (WHERE unit_type = 'verb_phrase')::integer AS verb_phrases,
  count(*) FILTER (WHERE unit_type = 'collocation')::integer AS collocations,
  count(*) FILTER (WHERE unit_type = 'sentence_pattern')::integer AS sentence_patterns,
  count(*) FILTER (WHERE source = '${BATCH}' AND id > 8703)::integer AS new_phrases
FROM public.words;`;
}

function summary(payload, transformed) {
  const before = payload.words;
  const changed = transformed.filter((word, index) => JSON.stringify(word) !== JSON.stringify(before[index]));
  const counts = values => values.reduce((acc, word) => {
    acc[word.unit_type] = (acc[word.unit_type] || 0) + 1;
    return acc;
  }, {});
  return {
    source_count: before.length,
    source_hash: contentHash(before),
    existing_rows_changed: changed.length,
    content_overrides: Object.keys(OVERRIDES).length,
    additions: ADDITIONS.length,
    before_units: counts(before),
    after_units: counts(transformed),
    core_existing: transformed.filter(word => word.grammar_data?.phrase_quality === 'core').length
  };
}

function main() {
  const payload = loadPayload();
  const transformed = transformExisting(payload.words || []);
  const state = assertPlan(payload, transformed);
  const command = process.argv[2] || '--dry-run';
  if (command === '--sql') {
    process.stdout.write(buildSql(payload, transformed));
    return;
  }
  if (command === '--backup') {
    const target = process.argv[3];
    if (!target) throw new Error('Usage: --backup <path>');
    const cohort = payload.words.filter(word =>
      ['verb_phrase', 'expression'].includes(word.unit_type) ||
      word.grammar_data?.curation_batch === BATCH
    );
    fs.writeFileSync(target, JSON.stringify({
      createdAt: new Date().toISOString(),
      batch: BATCH,
      sourceHash: contentHash(payload.words),
      words: cohort
    }, null, 2) + '\n');
    console.log(`Wrote ${cohort.length} backup rows to ${target}`);
    return;
  }
  console.log(JSON.stringify({
    ...summary(payload, transformed),
    already_applied: state.alreadyApplied
  }, null, 2));
}

if (require.main === module) main();

module.exports = {
  ADDITIONS,
  BATCH,
  CORE_IDS,
  OVERRIDES,
  SENTENCE_PATTERN_IDS,
  VERB_PHRASE_IDS,
  WORD_IDS,
  contentHash,
  transformExisting
};
