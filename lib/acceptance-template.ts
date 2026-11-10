import { getDb } from './db';

export type AcceptanceTemplateCase = {
  id: string;
  title: string;
  steps: string;
  expected: string;
};

export type AcceptanceTemplateGroup = {
  name: string;
  cases: AcceptanceTemplateCase[];
};

/**
 * Initial template. Cases 0.x–E2 follow the acceptance workbook.
 * B6–B20 are voice behaviors already in the product and missing from that sheet.
 * Seeded once; later deletes stay deleted.
 */
export const ACCEPTANCE_TEMPLATE: AcceptanceTemplateGroup[] = [
  {
    name: '0.前置',
    cases: [
      {
        id: '0.0',
        title: '本轮样例',
        steps: '主样例用贵州茅台 600519。池外备选东鹏饮料 605499；若已在池，改用百润 002568。',
        expected: '删除密码是 EVA，区分大小写。结果记为未测、通过、未通过、阻塞。语音入口不通时，B 组整组标阻塞。',
      },
      {
        id: '0.1',
        title: '代码与容器',
        steps: 'git pull 后执行 docker compose up -d --build --force-recreate app worker。',
        expected: 'app 和 worker 正常，没有持续重启。',
      },
      {
        id: '0.2',
        title: '首页可开',
        steps: '打开用户首页（域名或 IP）。',
        expected: '标题为 Eva - 财报智能分析助手。',
      },
      {
        id: '0.3',
        title: 'AI 连接性',
        steps: '打开数据采集 /admin/sources，找到 AI 连接性，点检测。',
        expected: 'LLM，以及语音鉴权、ASR、TTS 为成功。没有多余的干扰入口提示。',
      },
      {
        id: '0.4',
        title: '语音 WS 入口',
        steps: '点麦克风，在 Network 里看 /api/voice/asr。',
        expected: '出现 101 后再测语音。否则记阻塞，并跳过整组 B。',
      },
    ],
  },
  {
    name: 'A.用户主路径',
    cases: [
      {
        id: 'A1',
        title: '简称/代码检索',
        steps: '在首页搜「茅台」或「600519」。',
        expected: '出现公司卡片，可以进入详情。',
      },
      {
        id: 'A2',
        title: '池外加入（可选）',
        steps: '搜一家未入库公司，加入监控池，并立即抓取。',
        expected: '有成功提示。数据采集页能看到这条任务。',
      },
      {
        id: 'A3',
        title: '同名/多匹配',
        steps: '搜容易混在一起的前缀，例如「中国」。',
        expected: '列表给出多个匹配，可以选中其中一家。',
      },
      {
        id: 'A4',
        title: '三栏详情',
        steps: '进入 600519 最新一份已智析的报告。',
        expected: '左边 PDF，中间概览，右边追问。',
      },
      {
        id: 'A5',
        title: '四核 + 角标',
        steps: '点营收、归母净利润、EPS、ROE 旁边的页码角标。',
        expected: '左栏跳到对应页并高亮。',
      },
      {
        id: 'A6',
        title: '可验证追问',
        steps: '问：本期营业收入和归母净利润分别是多少？同比怎么变的？',
        expected: '流式回答，带页码。点角标可以再跳回原文。数字按本期分段或表格展示，不要把历年堆成一段。',
      },
      {
        id: 'A7',
        title: '划词追问（可选）',
        steps: '在 PDF 里划词，加入智析，再提一个短问题。',
        expected: '回答带上所选原文。',
      },
      {
        id: 'A8',
        title: '非标预警',
        steps: '打开一份有非标审计意见的年报（有才测）。',
        expected: '顶栏有红条，可以跳到原文。指标数字仍然看得到。',
      },
      {
        id: 'A9',
        title: '未见审计意见',
        steps: '打开一份季报详情。',
        expected: '不要假绿灯。可以显示未见或无意见类文案。',
      },
      {
        id: 'A10',
        title: '题外边界',
        steps: '问：明天天气怎么样。',
        expected: '短答，并提示超出财报范围。不编造数字。',
      },
      {
        id: 'A11',
        title: '赞踩',
        steps: '对任意一条答案点赞或踩。',
        expected: '提交成功。访问审计里能看到这条反馈。',
      },
      {
        id: 'A12',
        title: '相关问题',
        steps: '回答结束后，点一条推荐追问。',
        expected: '能再发出一轮问题。',
      },
    ],
  },
  {
    name: 'B.实时语音',
    cases: [
      {
        id: 'B1',
        title: '实时对话',
        steps: '打开麦克风，短问一句营收。',
        expected: '不是整段录完再转写。可以边说边出字。',
      },
      {
        id: 'B2',
        title: '打断',
        steps: '回答或播报进行到一半时，再说一句话（至少两个字）。',
        expected: '能打断当前播报或生成。',
      },
      {
        id: 'B3',
        title: '跳页',
        steps: '说「跳到第 8 页」或「第12页」。',
        expected: 'PDF 翻到该页。',
      },
      {
        id: 'B4',
        title: '回首页',
        steps: '说「回首页」或「换一家」。',
        expected: '回到搜索页。语音会话还在，没有结束。',
      },
      {
        id: 'B5',
        title: '退出',
        steps: '说「再见」或「退下吧」。',
        expected: '语音会话结束。这和「回首页」不同。',
      },
      {
        id: 'B6',
        title: '前后翻页',
        steps: '说「下一页」，再说「上一页」，再说「最后一页」。',
        expected: 'PDF 按这三句分别翻页。',
      },
      {
        id: 'B7',
        title: '暂停与继续朗读',
        steps: '播报中说「先别念了」，再说「继续朗读」。',
        expected: '先停住，再说时从暂停处继续。',
      },
      {
        id: 'B8',
        title: '说重点 / 讲细一点',
        steps: '说「说重点」，下一轮再说「讲细一点」。',
        expected: '回答分别变短、变细，不把这两句当成财报问题。',
      },
      {
        id: 'B9',
        title: '收起和展开概览',
        steps: '说「收起概览」，再说「展开概览」。',
        expected: '中间栏收起后再打开。',
      },
      {
        id: 'B10',
        title: '缩放',
        steps: '说「放大一点」「缩小一点」「适合宽度」。',
        expected: 'PDF 缩放跟着这三句变化。',
      },
      {
        id: 'B11',
        title: '再看出处',
        steps: '有过带出处的回答后，说「出处在哪」。',
        expected: '再次跳到上一次引用的原文页。',
      },
      {
        id: 'B12',
        title: '朗读页面和章节',
        steps: '说「读一下这页开头」，再说「朗读第三节」。',
        expected: '先读当前页开头，再按章节读。',
      },
      {
        id: 'B13',
        title: '目录',
        steps: '说「打开目录」，再说「跳到管理层讨论」。',
        expected: '先打开目录，再跳到对应章节。',
      },
      {
        id: 'B14',
        title: '指令不误伤提问',
        steps: '说「第八页讲了什么」，再说「下一页的营收是多少」。',
        expected: '这两句进入问答，不要只翻页。',
      },
      {
        id: 'B15',
        title: '模糊公司要确认',
        steps: '在首页说「贵州茅」。对照再说全称「贵州茅台」或代码「600519」。',
        expected: '模糊说法先问「是这家吗」，可以说确定或不是。全称和代码直接打开。',
      },
      {
        id: 'B16',
        title: '回答自动跳原文',
        steps: '用语音问一个有出处的问题。再到偏好设置-语音，关掉「语音回答自动跳原文并高亮」后再问一次。',
        expected: '默认跳到第一个出处并高亮，提示「答案在第 N 页」。关掉后不再自动跳，点出处仍可跳。',
      },
      {
        id: 'B17',
        title: '停顿后可取消',
        steps: '说完一句后停住，在即将发送的短窗口里取消。',
        expected: '大约 1 秒内能取消，这句话不会发出去。',
      },
      {
        id: 'B18',
        title: '长时间不说话',
        steps: '开着语音，大约 3 分钟什么都不说。再开一次，点关闭按钮左边的麦克风，和旁边的人说几句，然后把麦克风打开。',
        expected: '麦克风开着时，大约 3 分钟没说话会提示长时间未互动并结束会话。关掉麦克风后会话还在，旁边的话不会被当成提问；再打开后可以继续说。',
      },
      {
        id: 'B19',
        title: '欢迎语默认关闭',
        steps: '看偏好设置-语音里的欢迎语。打开后再关一次。',
        expected: '默认关闭。开关能记住。',
      },
      {
        id: 'B20',
        title: '打字也能发本地指令',
        steps: '在输入框打「下一页」和「回首页」，不要开麦。',
        expected: '和说出来是同一套指令，分别翻页、回搜索页。',
      },
    ],
  },
  {
    name: 'C.数据采集',
    cases: [
      {
        id: 'C1',
        title: '多源状态',
        steps: '打开 /admin/sources。',
        expected: '上交所、深交所、北交所、巨潮等来源看得到。',
      },
      {
        id: 'C2',
        title: '链路状态',
        steps: '看排队、下载、解析、智析。',
        expected: '四步分得清。',
      },
      {
        id: 'C3',
        title: '进详情',
        steps: '点一个已智析的期次。',
        expected: '进入三栏详情。',
      },
      {
        id: 'C4',
        title: '再解析（可选）',
        steps: '对一条报告点再解析。',
        expected: '任务入队，状态会变化。',
      },
    ],
  },
  {
    name: 'D.运营后台',
    cases: [
      {
        id: 'D1',
        title: '入口与删除密码',
        steps: '直接打开 /admin/metrics。再找一处删除，先输错密码，再输入 EVA。',
        expected: '运营页不用登录。导航有数据采集、解析总览、指标核对、访问审计、用户调研、反馈收集。错密码删不掉，EVA 才能删。',
      },
      {
        id: 'D2',
        title: '解析总览筛选',
        steps: '在解析总览里按异常、缺核、同比离谱筛选，再快速检索「暂无同比」。',
        expected: '能过滤出对应行。',
      },
      {
        id: 'D3',
        title: '报告全称标红',
        steps: '看错抓类标题里的关键字。',
        expected: '命中的字被标红。',
      },
      {
        id: 'D4',
        title: '审计意见列',
        steps: '按非标、标准、未见过滤。',
        expected: '列和过滤都能用。',
      },
      {
        id: 'D5',
        title: '异常/审核',
        steps: '同一条在「标记异常」和「审核通过」之间切换。',
        expected: '两种状态互斥，列表显示正确。',
      },
      {
        id: 'D6',
        title: '删除错抓',
        steps: '对一条错抓报告点删除，输入 EVA 确认。',
        expected: '这一行从列表消失。',
      },
      {
        id: 'D7',
        title: '解析按钮',
        steps: '试单条解析和批量解析。',
        expected: '有提示。页面向下滚时顶栏还在。',
      },
      {
        id: 'D8',
        title: '期次外链',
        steps: '在解析总览和指标核对里点期次。',
        expected: '新标签打开对应详情。',
      },
      {
        id: 'D9',
        title: '指标核对',
        steps: '打开 /admin/check，搜一家能对上的和一家有差异的。',
        expected: '和问财对照。已删除的期次不出现。百分比不会被折算成亿元。',
      },
      {
        id: 'D10',
        title: '访问审计 + AI 归纳',
        steps: '打开访问审计，看记录，再点 AI 归纳。',
        expected: '归纳是结论，不是按公司流水账。',
      },
      {
        id: 'D11',
        title: '用户调研',
        steps: '生成邀请，打开 /survey/短码 提交，再回到结果标签。',
        expected: '结果里显示已反馈。AI 归纳只在结果标签出现。',
      },
      {
        id: 'D12',
        title: '反馈收集',
        steps: '在站内提交一条反馈，或打开 /feedback，再到 /admin/feedback。',
        expected: '列表里有这条。AI 归纳可用。',
      },
      {
        id: 'D13',
        title: '各页快速检索',
        steps: '六个运营页各搜一句页面上能看到的文案。',
        expected: '表格只留下匹配行。',
      },
      {
        id: 'D14',
        title: '验收测试不进导航',
        steps: '从运营导航逐项看一遍，再手动打开 /admin/tests。',
        expected: '导航里没有「测试」。手动地址能打开本页。',
      },
    ],
  },
  {
    name: 'E.文档与体验指引',
    cases: [
      {
        id: 'E1',
        title: '/docs 四篇',
        steps: '打开文档中心 /docs。',
        expected: '只有产品介绍、设计理念、财报说明、技术架构。',
      },
      {
        id: 'E2',
        title: '体验指引三步',
        steps: '按体验路径走：打开茅台，点指标角标，再追问一句。',
        expected: '大约 3 分钟可以走通。',
      },
    ],
  },
];

export function acceptanceTemplateIds() {
  return ACCEPTANCE_TEMPLATE.flatMap((group) => group.cases.map((item) => item.id));
}

/** Insert the template the first time. A later wipe of groups does not bring it back. */
export async function ensureAcceptanceTemplate() {
  const db = getDb();
  await db.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(62409011)`;
    const existing = await tx`SELECT id FROM acceptance_seed WHERE id = 1`;
    if (existing.length) {
      const idle = ACCEPTANCE_TEMPLATE.flatMap((group) => group.cases).find((item) => item.id === 'B18');
      if (idle) {
        await tx`
          UPDATE acceptance_cases
          SET steps = ${idle.steps}, expected = ${idle.expected}
          WHERE title = ${`${idle.id} ${idle.title}`}
            AND steps = ${'开着语音，大约 60 秒什么都不说。'}
        `;
      }
      return;
    }
    for (let groupIndex = 0; groupIndex < ACCEPTANCE_TEMPLATE.length; groupIndex += 1) {
      const group = ACCEPTANCE_TEMPLATE[groupIndex];
      const [created] = await tx<{ id: number | string }[]>`
        INSERT INTO acceptance_groups (name, sort) VALUES (${group.name}, ${groupIndex + 1}) RETURNING id
      `;
      for (let caseIndex = 0; caseIndex < group.cases.length; caseIndex += 1) {
        const item = group.cases[caseIndex];
        await tx`
          INSERT INTO acceptance_cases (group_id, title, steps, expected, sort)
          VALUES (${created.id}, ${`${item.id} ${item.title}`}, ${item.steps}, ${item.expected}, ${caseIndex + 1})
        `;
      }
    }
    await tx`INSERT INTO acceptance_seed (id) VALUES (1)`;
  });
}
