import fetch from 'node-fetch'
import jwt from 'jsonwebtoken'
import jwtDecode from 'jwt-decode'
import GQLError from '../utils/GQLError.js'
import getUserId from '../utils/getUserId'
//import generateToken from '../utils/generateToken'
import validateToken from '../utils/validateToken'
import generateAccessToken from '../utils/accessToken'
import generateRefreshToken from '../utils/refreshToken'

const FB_APP_ID = '315261496071780'
const FB_APP_SECRET = 'e3f01ca5a52668c568490fc7bc385067'
const FB_ACCESS_URL = 'https://graph.accountkit.com/v1.3/access_token'
const FB_ME_URL = 'https://graph.accountkit.com/v1.3/me'

async function getFBAccessTokenByFBCode(code) {
  console.log('code', code)
  //const url = `${FB_ACCESS_URL}?grant_type=authorization_code&code=${code}&access_token=AA|${FB_APP_ID}|${FB_APP_SECRET}`
  const url = `https://graph.accountkit.com/v1.3/access_token?grant_type=authorization_code&code=${code}&access_token=AA|${FB_APP_ID}|${FB_APP_SECRET}`
  console.log('url', url)
  const accessToken = (await (await fetch(url)).json()).access_token
  console.log('acessToken', accessToken)
  return accessToken
}

async function getPhoneByFacebookAccessToken(token, appSecret) {
  const url = `https://graph.accountkit.com/v1.3/me/?access_token=${token}`
  console.log('url2', url)
  const phoneNumber = (await (await fetch(url)).json()).phone.number
  console.log('phoneNumber', phoneNumber)
  return phoneNumber
}

const Mutation = {
  async signIn(parent, { code }, { prisma }, info) {
    const accessToken = await getFBAccessTokenByFBCode(code)
    const phone = await getPhoneByFacebookAccessToken(accessToken)
    const user = await prisma.query.user({
      where: {
        phone
      }
    })

    if (!user) {
      const createdUser = await prisma.mutation.createUser({
        data: {
          phone
        }
      })
      return {
        user: createdUser,
        token: generateToken(createdUser.id)
      }
    } else {
      return {
        user: user,
        token: generateToken(user.id)
      }
    }
  },

  async updateTokens(parent, args, { prisma }, info) {
    const decodeAccessToken = jwtDecode(args.data.accessToken)
    console.log('decodeAccessToken', decodeAccessToken)

    if (decodeAccessToken.exp > currentTime) {
      return {
        user: user,
        refreshToken: args.data.refreshToken,
        accessToken: args.data.accessToken
      }
    }

    const user = await prisma.query.user({
      where: {
        id: decodeAccessToken.userId
      }
    })
    console.log('user', user)

    if (!user) {
      log.warn('Wrong JWT token validation attempt')
      throw new GQLError({ message: 'User not found', code: 404 })
    }

    const currentTime = Date.now() / 1000
    console.log('currentTime', currentTime)

    const decodeRefreshToken = await jwt.verify(args.data.refreshToken, 'thisisasecret')
    console.log('decodeRefreshToken', decodeRefreshToken)

    const refreshToken = await prisma.query.refreshTokens({
      where: {
        owner: {
          phone: decodeRefreshToken.userPhone
        }
      }
    })
    console.log('refreshToken', refreshToken)
    console.log('refreshToken.id', refreshToken.id)
    if (!refreshToken) {
      log.warn('Wrong JWT token validation attempt')
      throw new GQLError({ message: 'RefreshToken not found', code: 404 })
    }

    if (decodeAccessToken.exp < currentTime) {
      const deleteRefreshToken = prisma.mutation.deleteRefreshToken({
        where: {
          id: refreshToken.id
        }
      })
      console.log('deleteRefreshToken', deleteRefreshToken)
      const newRefreshToken = await prisma.mutation.createRefreshToken({
        data: {
          token: generateRefreshToken(user.phone),
          owner: {
            connect: {
              id: user.id
            }
          }
        }
      })
      return {
        refreshToken,
        accessToken: generateAccessToken(newRefreshToken.id)
      }
    }
  },

  async createUser(parent, args, { prisma }, info) {
    const phoneTaken = await prisma.exists.User({ phone: args.data.phone })
    if (phoneTaken) {
      throw new Error('Phone already taken')
    }
    const user = await prisma.mutation.createUser({
      data: {
        phone: args.data.phone
      }
    })
    console.log('user', user)
    const refreshToken = await prisma.mutation.createRefreshToken({
      data: {
        token: generateRefreshToken(args.data.phone),
        owner: {
          connect: {
            id: user.id
          }
        }
      }
    })
    console.log('refreshToken', refreshToken)
    return {
      user,
      refreshToken: refreshToken.token,
      accessToken: generateAccessToken(user.id, refreshToken.id)
    }
  },

  // async createUser(parent, args, { prisma }, info) {
  //   const phoneTaken = await prisma.exists.User({ phone: args.data.phone })
  //   if (phoneTaken) {
  //     throw new Error('Phone already taken')
  //   }

  //   const user = await prisma.mutation.createUser({
  //     data: {
  //       phone: args.data.phone,
  //     }
  //   })

  //   console.log('user', user)

  //   return {
  //     user,
  //     accessToken: generateToken(user.id, 1800)
  //   }
  // },
  deleteUser(parent, args, { prisma, request }, info) {
    const userId = getUserId(request)
    console.log('userId', userId)

    return prisma.mutation.deleteUser(
      {
        where: {
          id: userId
        }
      },
      info
    )
  },

  updateUser(parent, args, { prisma, request }, info) {
    const userId = getUserId(request)

    return prisma.mutation.updateUser(
      {
        where: {
          id: userId
        },
        data: args.data
      },
      info
    )
  },

  createPost(parent, args, { prisma, request }, info) {
    const userId = getUserId(request)

    return prisma.mutation.createPost(
      {
        data: {
          title: args.data.title,
          body: args.data.body,
          published: args.data.published,
          author: {
            connect: {
              id: userId
            }
          }
        }
      },
      info
    )
  },

  async deletePost(parent, args, { prisma, request }, info) {
    const userId = getUserId(request)
    const postExists = await prisma.exists.Post({
      id: args.id,
      author: {
        id: userId
      }
    })

    if (!postExists) {
      throw new Error('Unable to delete post')
    }

    return prisma.mutation.deletePost(
      {
        where: {
          id: args.id
        }
      },
      info
    )
  },

  async updatePost(parent, args, { prisma, request }, info) {
    const userId = getUserId(request)
    const postExists = await prisma.exists.Post({
      id: args.id,
      author: {
        id: userId
      }
    })
    const isPublished = await prisma.exists.Post({
      id: args.id,
      published: true
    })

    if (!postExists) {
      throw new Error('Unable to update post')
    }

    if (isPublished && args.data.published === false) {
      await prisma.mutation.deleteManyComments({
        where: { post: { id: args.id } }
      })
    }

    return prisma.mutation.updatePost(
      {
        where: {
          id: args.id
        },
        data: args.data
      },
      info
    )
  },

  async createComment(parent, args, { prisma, request }, info) {
    const userId = getUserId(request)
    const postExists = await prisma.exists.Post({
      id: args.data.post,
      published: true
    })

    if (!postExists) {
      throw new Error('Unable to find post')
    }

    return prisma.mutation.createComment(
      {
        data: {
          text: args.data.text,
          author: {
            connect: {
              id: userId
            }
          },
          post: {
            connect: {
              id: args.data.post
            }
          }
        }
      },
      info
    )
  },

  async deleteComment(parent, args, { prisma, request }, info) {
    const userId = getUserId(request)
    const commentExists = await prisma.exists.Comment({
      id: args.id,
      author: {
        id: userId
      }
    })

    if (!commentExists) {
      throw new Error('Unable to delete comment')
    }

    return prisma.mutation.deleteComment(
      {
        where: {
          id: args.id
        }
      },
      info
    )
  },

  async updateComment(parent, args, { prisma, request }, info) {
    const userId = getUserId(request)
    const commentExists = await prisma.exists.Comment({
      id: args.id,
      author: {
        id: userId
      }
    })

    if (!commentExists) {
      throw new Error('Unable to update comment')
    }

    return prisma.mutation.updateComment(
      {
        where: {
          id: args.id
        },
        data: args.data
      },
      info
    )
  }
}

export { Mutation as default }
