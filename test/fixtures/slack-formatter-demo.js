
// Demo script to show the Slack formatter in action

const { convertToSlackFormat } = require('../../src/utils/slack-formatter');

console.log('=== Slack Markdown Formatter Demo ===\n');

const examples = [
  {
    name: 'Headers and Bold/Italic',
    input: '# Main Title\n\nThis is **bold** and this is *italic* and this is ***both***.'
  },
  {
    name: 'Code Blocks',
    input: 'Here is some code:\n\n```javascript\nfunction hello() {\n  console.log("world");\n}\n```'
  },
  {
    name: 'Links',
    input: 'Check out [GitHub](https://github.com) and [Google](https://google.com)!'
  },
  {
    name: 'Tables',
    input: '| Feature | Status |\n|---------|--------|\n| API | Ready |\n| UI | In Progress |'
  },
  {
    name: 'Lists',
    input: '## Todo:\n\n- Item 1\n- Item 2\n- Item 3'
  },
  {
    name: 'Mixed Formatting',
    input: '# Summary\n\nThe **quick** _brown_ fox:\n\n- Has `speed`\n- Uses ~~walking~~ running\n- See [more info](https://example.com)\n\n```python\nprint("hello")\n```'
  }
];

examples.forEach(({ name, input }) => {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Example: ${name}`);
  console.log(`${'='.repeat(60)}`);
  console.log('\nINPUT (Markdown):');
  console.log(input);
  console.log('\nOUTPUT (Slack format):');
  console.log(convertToSlackFormat(input));
});

console.log(`\n${'='.repeat(60)}`);
console.log('Done!');
console.log(`${'='.repeat(60)}\n`);
