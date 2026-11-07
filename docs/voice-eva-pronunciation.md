# Eva 英文读音

音色仍是 `zh_female_vv_uranus_bigtts`，接口仍是双向流。界面上的 Eva 不改。

`context_texts` 只控制语气，不能改词的读法。中文词库会把单独的 `Eva` 读成「伊娃」。

播报前只把独立出现的品牌词换成 `Eevah`（`evaluate`、`EvaX`、`EVA-01` 不动）。会话 `additions.pronunciation_dict.tone` 再按官方文本转写规则写成 `Eevah/ee vuh`，让它按英文 Eva（EE-vuh）读，而不是拼字母，也不是中文名。

验收要听：`我是Eva，本期收入3,835.54亿元。`、`谢谢你，Eva。`。中文和金额应保持原样。
