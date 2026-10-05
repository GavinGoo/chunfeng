// 单元与集成测试的公共环境：默认使用模拟上游，绝不访问真实服务
process.env.MOCK_UPSTREAMS ??= 'true';
process.env.JEV_API_URL ??= 'http://jev.test/v1/systemone';
process.env.JEV_API_KEY ??= 'test-jev-key';
process.env.LLM_API_URL ??= 'http://llm.test/chat/completions';
process.env.LLM_API_KEY ??= 'test-llm-key';
process.env.LLM_MODEL ??= 'deepseek-flash';
process.env.LOG_LEVEL ??= 'silent';
process.env.IP_HASH_SALT ??= 'test-salt';
