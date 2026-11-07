# Eva英语读音：已接入的控制与边界

2026-11-07核查当前实现：同一AI Gateway → Volcengine Seed TTS 2.0双向流，音色 `zh_female_vv_uranus_bigtts`。不换供应商、账号、音色或协议。

- 播报文本保留英文 `Eva`，仅独立词统一大小写，撤销汉字替换。UI原文不变，金额规范化保留。
- 按官方双向接口文档，在 StartSession 的 `req_params.additions` JSON字符串中传入 `context_texts`，限定独立品牌词采用美式人名发音，其他中文、语速、金额读法保持。音标只在控制指令中，不进入朗读文本。
- 这是**语音指令软约束，不是音素级发音锁定**。官方发音词典文档列出拼音修正与文本转写，未提供此双向路径可用的美式IPA/CMU词典规则；SSML文档明确双向流不支持SSML。因此没有虚构 `ipa`/`phoneme` 字段，也没有发送SSML标签或把整段设为英语。
- 尚需真实上游确认 Gateway转发扩展参数及试听效果；代码/协议单测不能证明标准发音。当前不宣称精准发音已完成实测。
- 若软指令不足，最小的精确方案需另行确认：在同供应商可支持的单向SSML路径合成经审核的品牌词音频，再解决与主语音的自然拼接/取消；本次未擅自切接口或增加拼接管线。

官方来源（本轮打开）：
- https://docs.volcengine.com/docs/doubao-voice/bidirectional-streaming-text-to-speech-websocket?lang=zh
- https://docs.volcengine.com/docs/doubao-voice/websocket-bidirectional-streaming-v3?lang=zh
- https://docs.volcengine.com/docs/doubao-voice/ssm-lmarkuplanguage?lang=en

验收须试听：`我是Eva，本期收入3,835.54亿元。`、`谢谢你，Eva。`、纯中文及不含品牌的英文对照；确认英文重音/元音、中文与金额不变、打断/关闭正常。
