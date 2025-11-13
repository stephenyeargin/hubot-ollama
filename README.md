> [!IMPORTANT]
> Be sure to update this README!

# template-hubot-script

Template repository for creating a new Hubot script package.

## Installation

In your hubot repository, run:

`npm install template-hubot-script --save`

Then add **template-hubot-script** to your `external-scripts.json`:

```json
["template-hubot-script"]
```

### Configuration

| Environment Variables    | Required? | Description                              |
| ------------------------ | :-------: | ---------------------------------------- |
| `HUBOT_EXAMPLE_API_KEY`  | Yes       | API key from the developer console       |

## Usage

```
user1> hubot hello:get
hubot> Hello world!
```
