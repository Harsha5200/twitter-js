const express = require('express')
const {open} = require('sqlite')
const sqlite3 = require('sqlite3')
const path = require('path')
const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken')

const databasePath = path.join(__dirname, 'twitterClone.db')

const app = express()
app.use(express.json())
let db = null

const intializeDbAndServer = async () => {
  try {
    db = await open({
      filename: databasePath,
      driver: sqlite3.Database,
    })
    app.listen(3000, () =>
      console.log('Server Running at http://localhost:3000/'),
    )
  } catch (e) {
    console.log(`DB Error: ${e.message}`)
    process.exit(1)
  }
}

intializeDbAndServer()

function authenticateToken(request, response, next) {
  let jwtToken
  const authHeader = request.headers['authorization']
  if (authHeader !== undefined) {
    jwtToken = authHeader.split(' ')[1]
  }
  if (jwtToken === undefined) {
    response.status(401)
    response.send('Invalid JWT Token')
  } else {
    jwt.verify(jwtToken, 'MY_SECRET_TOKEN', async (error, payload) => {
      if (error) {
        response.status(401)
        response.send('Invalid JWT Token')
      } else {
        const user = await db.get(
          `SELECT user_id FROM user WHERE username = ?`,
          payload.username,
        )
        request.user = user
        next()
      }
    })
  }
}

app.post('/register/', async (request, response) => {
  const {username, password, name, gender} = request.body
  const hashedPassword = await bcrypt.hash(password, 10)
  const selectUserQuery = `SELECT * FROM user WHERE username = ?`
  if (password.length < 6) {
    response.status(400)
    response.send('Password is too short')
    return
  }
  const dbUser = await db.get(selectUserQuery, [username])
  if (dbUser !== undefined) {
    response.status(400)
    response.send('User already exists')
    return
  }
  const registerQuery = `INSERT INTO user (name, username, password, gender) VALUES (?, ?, ?, ?)`
  await db.run(registerQuery, [name, username, hashedPassword, gender])
  response.status(200)
  response.send('User created successfully')
})

app.post('/login/', async (request, response) => {
  const {username, password} = request.body
  const selectUserQuery = `SELECT * FROM user WHERE username = ?`
  const databaseUser = await db.get(selectUserQuery, [username])
  if (databaseUser === undefined) {
    response.status(400)
    response.send('Invalid user')
    return
  }
  const isPasswordMatched = await bcrypt.compare(
    password,
    databaseUser.password,
  )
  if (isPasswordMatched === false) {
    response.status(400)
    response.send('Invalid password')
    return
  }
  const payload = {username: username}
  const jwtToken = jwt.sign(payload, 'MY_SECRET_TOKEN')
  response.send({jwtToken})
  const user = await db.get(
    `SELECT user_id FROM user WHERE username = ?`,
    payload.username,
  )
  console.log(user)
})

//Returns the latest tweets of people whom the user follows. Return 4 tweets at a time
app.get('/user/tweets/feed/', authenticateToken, async (request, response) => {
  try {
    const userId = request.user.user_id
    const getUserTweets =
      await db.all(`SELECT user.username, tweet.tweet, tweet.date_time as dateTime FROM tweet JOIN user ON tweet.user_id = user.user_id WHERE tweet.user_id IN (SELECT following_user_id FROM follower WHERE
    follower_user_id = ${userId}) ORDER BY date_time DESC LIMIT 4`)
    response.status(200).json(getUserTweets)
  } catch (error) {
    console.error('Error fetching user tweets:', error)
    response.status(500).json({message: 'Internal Server Error'})
  }
})

//Returns the list of all names of people whom the user follows
app.get('/user/following/', authenticateToken, async (request, response) => {
  const userId = request.user.user_id
  const getUserFollowing =
    await db.all(`SELECT name FROM user WHERE user_id IN (SELECT following_user_id FROM follower WHERE
    follower_user_id = ${userId})`)
  response.status(200)
  response.json(getUserFollowing)
})

//Returns the list of all names of people who follows the user
app.get('/user/followers/', authenticateToken, async (request, response) => {
  const userId = request.user.user_id
  const getUserFollowers =
    await db.all(`SELECT name FROM user WHERE user_id IN (SELECT follower_user_id FROM follower WHERE
    following_user_id = ${userId})`)
  response.status(200)
  response.json(getUserFollowers)
})

//return the tweet, likes count, replies count and date-time
app.get('/tweets/:tweetId/', authenticateToken, async (request, response) => {
  const userId = request.user.user_id
  const tweetId = request.params.tweetId
  const getTweets =
    await db.get(`SELECT * FROM tweet WHERE tweet_id = ${tweetId} AND user_id IN (SELECT following_user_id FROM follower WHERE
    follower_user_id = ${userId})`)
  if (!getTweets) {
    response.status(401)
    response.send('Invalid Request')
  } else {
    response.status(200)
    response.send(getTweets)
  }
})

//return the list of usernames who liked the tweet
app.get(
  '/tweets/:tweetId/likes/',
  authenticateToken,
  async (request, response) => {
    const userId = request.user.user_id
    const tweetId = request.params.tweetId
    const getTweetLikeUsers =
      await db.all(`SELECT name FROM user WHERE user_id IN (SELECT user_id FROM like WHERE
    tweet_id = ${tweetId} AND user_id IN (SELECT following_user_id FROM follower WHERE follower_user_id = ${userId}))`)
    if (getTweetLikeUsers.length === 0) {
      response.status(401)
      response.send('Invalid Request')
    } else {
      response.status(200)
      response.send({likes: getTweetLikeUsers.map(user => user.name)})
    }
  },
)

//If the user requests a tweet of a user he is following, return the list of replies.
app.get(
  '/tweets/:tweetId/replies/',
  authenticateToken,
  async (request, response) => {
    const userId = request.user.user_id
    const tweetId = request.params.tweetId
    const getTweetReplies =
      await db.all(`SELECT name, reply FROM reply JOIN user ON reply.user_id = user.user_id WHERE reply.tweet_id = ${tweetId} AND 
    reply.user_id IN (SELECT following_user_id FROM follower WHERE follower_user_id = ${userId})`)
    if (getTweetReplies.length === 0) {
      response.status(401)
      response.send('Invalid Request')
    } else {
      response.status(200)
      response.json({
        replies: getTweetReplies.map(user => ({
          name: user.name,
          reply: user.reply,
        })),
      })
    }
  },
)

//Returns a list of all tweets of the user
app.get('/user/tweets/', authenticateToken, async (request, response) => {
  const userId = request.user.user_id
  const getUserQuery = await db.all(
    `SELECT tweet.tweet, like.like_id as likes, reply.reply as replies, tweet.date_time as dateTime FROM (tweet JOIN like ON tweet.tweet_id = like.tweet_id) t join reply ON t.tweet_id = reply.tweet_id WHERE 
    t.user_id IN (SELECT following_user_id FROM follower WHERE follower_user_id = ${userId})`,
  )
  response.status(200)
  response.json(getUserQuery)
})

//Create a tweet in the tweet table
app.post('/user/tweets/', authenticateToken, async (request, response) => {
  const userId = request.user.user_id
  const {tweet} = request.body
  const date_time = new Date().toISOString()
  await db.run(`INSERT into tweet (tweet, user_id, date_time) VALUES
            (
                '${tweet}',
                '${userId}',
                '${date_time}'
            )`)
  response.status(200)
  response.send('Created a Tweet')
})

//If the user deletes his tweet
app.delete(
  '/tweets/:tweetId/',
  authenticateToken,
  async (request, response) => {
    const userId = request.user.user_id
    const tweetId = request.params.tweetId
    const checkTweetQuery = await db.all(
      `SELECT * FROM tweet WHERE tweet_id = ${tweetId}`,
    )
    if (!checkTweetQuery || checkTweetQuery.user_id !== userId) {
      response.status(401)
      response.send('Invalid Request')
    }
    const deleteTweetQuery = `
    DELETE FROM
        tweet
    WHERE
        tweet_id = ${tweetId} 
    `
    await db.run(deleteTweetQuery)
    response.status(200)
    response.send('Tweet Removed')
  },
)

module.exports = app
