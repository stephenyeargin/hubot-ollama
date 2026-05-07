module.exports = (robot) => {
  // This intentionally does not reply; it only marks the message as matched.
  robot.respond(/.*/i, () => {});
};
