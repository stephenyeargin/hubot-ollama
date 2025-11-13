// Description:
//   Description of the script's purpose.
//
// Configuration:
//   HUBOT_EXAMPLE_VARIABLE - Example of a variable set at configuration.
//
// Commands:
//   hubot hello - Gets a message
//   hubot hello <message> - Sends a message
//

module.exports = (robot) => {
  // Example: Centralized request handler
  const makeAPIRequest = (method, path, payload, callback) => {
    if (method.toUpperCase() === 'GET') {
      return robot.http(`https://api.example.com/${path}`)
        .headers({
          'x-api-key': process.env.HUBOT_EXAMPLE_API_KEY,
        })
        .query(payload)
        .get()((err, res, body) => {
          callback(err, res, body);
        });
    }

    if (method.toUpperCase() === 'POST') {
      const data = JSON.stringify(payload);
      return robot.http(`https://api.example.com/${path}`)
        .headers({
          'x-api-key': process.env.HUBOT_EXAMPLE_API_KEY,
        })
        .post(data)((err, res, body) => {
          callback(err, res, body);
        });
    }

    robot.logger.error(`Invalid method: ${method}`);
    return callback('Invalid method!');
  };

  // Example: Calls an API with a GET request
  robot.respond(/hello:get$/i, (msg) => {
    robot.logger.debug('Calling hello:get');

    return makeAPIRequest('GET', 'v1/status.json', {}, (err, _res, body) => {
      if (err) {
        robot.logger.error(err);
        msg.send(err);
        return;
      }

      try {
        const apiResponse = JSON.parse(body);
        msg.send(`GET: ${apiResponse.message}`);
      } catch (parseError) {
        robot.logger.error(parseError);
      }
    });
  });

  // Example: Calls an API with a POST request
  robot.respond(/hello:post (.*)/i, (msg) => {
    robot.logger.debug('Calling hello:post');
    const payload = msg.match[1];

    return makeAPIRequest('POST', 'v1/status', { payload }, (err, _res, body) => {
      if (err) {
        robot.logger.error(err);
        msg.send(err.toString());
        return;
      }

      try {
        const apiResponse = JSON.parse(body);
        msg.send(`POST: ${apiResponse.status}`);
      } catch (parseError) {
        robot.logger.error(parseError);
      }
    });
  });

  // Example: Alter the appearance based on the adapter in use
  robot.respond(/slack test/i, (msg) => {
    if (/slack/.test(robot.adapterName)) {
      msg.send({
        attachments: [
          {
            title: 'Slack Test',
            text: 'This message is formatted for Slack.',
            color: '#36a64f',
          },
        ],
      });
      return;
    }
    msg.send('This message is not formatted for Slack.');
  });
};
