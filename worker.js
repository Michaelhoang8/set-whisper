import { build, inspect, experiment, deserialize, serialize, stats } from './core.js';
self.onmessage = async ({ data }) => {
  try {
    let result;
    if (data.action === 'build') {
      const filter = await build(data.items, data.m, data.k);
      result = { filter, stats: stats(filter) };
    } else if (data.action === 'query')
      result = await inspect(data.filter, data.queries, data.reference);
    else if (data.action === 'experiment')
      result = await experiment(data.filter, data.reference, data.count);
    else if (data.action === 'import') {
      const filter = await deserialize(data.value);
      result = { filter, stats: stats(filter) };
    } else if (data.action === 'export') result = await serialize(data.filter);
    else throw Error('Unknown operation.');
    self.postMessage({ result });
  } catch (e) {
    self.postMessage({ error: e.message });
  }
};
