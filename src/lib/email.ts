const MAILGUN_API_KEY = process.env.MAILGUN_API_KEY
const MAILGUN_DOMAIN = process.env.MAILGUN_DOMAIN
const FROM_EMAIL = process.env.MAILGUN_FROM_EMAIL ?? `Extension Pulse <noreply@${MAILGUN_DOMAIN}>`
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3002'

interface SendTokenEmailParams {
  to: string
  formName: string
  programName: string
  token: string
  formSlug: string
  expiresAt: string
  accountInviteUrl?: string   // included when we're also creating their viewer account
}

export async function sendTokenEmail(params: SendTokenEmailParams): Promise<void> {
  const { to, formName, programName, token, formSlug, expiresAt, accountInviteUrl } = params
  const link = `${APP_URL}/f/${formSlug}?token=${token}`
  const expiry = new Date(expiresAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })

  if (!MAILGUN_API_KEY || !MAILGUN_DOMAIN) {
    console.log(`\n[EMAIL - no Mailgun key set]\nTo: ${to}\nSubject: Your form link — ${formName}\nLink: ${link}${accountInviteUrl ? `\nAccount setup: ${accountInviteUrl}` : ''}\n`)
    return
  }

  const accountTextBlock = accountInviteUrl
    ? [``, `You've also been given viewer access to ${programName} so you can track your submission. Set up your account here:`, accountInviteUrl]
    : []

  const text = [
    `You've been invited to complete a form for ${programName}.`,
    '',
    `Form: ${formName}`,
    `Link: ${link}`,
    '',
    `This link is personal to you and expires on ${expiry}.`,
    'Do not share it with others.',
    ...accountTextBlock,
  ].join('\n')

  const accountHtmlBlock = accountInviteUrl
    ? `<div style="margin-top:24px;padding:16px;background:#f9f9f9;border-radius:8px;border:1px solid #e5e7eb;">
  <p style="margin:0 0 8px;font-size:14px;font-weight:600;color:#111;">Viewer account access</p>
  <p style="margin:0 0 12px;font-size:13px;color:#555;">You've also been given viewer access to <strong>${programName}</strong> so you can track your submission.</p>
  <a href="${accountInviteUrl}" style="display:inline-block;background:#fff;color:#ea580c;border:1.5px solid #ea580c;padding:8px 18px;border-radius:6px;text-decoration:none;font-size:13px;font-weight:600;">Set up your account</a>
</div>`
    : ''

  const html = `
<!DOCTYPE html>
<html>
<body style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:32px 16px;color:#111;">
  <h2 style="font-size:20px;margin-bottom:8px;">${formName}</h2>
  <p style="color:#555;margin-bottom:24px;">You've been invited to complete a form for <strong>${programName}</strong>.</p>
  <a href="${link}" style="display:inline-block;background:#ea580c;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">Open form</a>
  <p style="margin-top:24px;font-size:13px;color:#888;">This link is personal to you and expires ${expiry}. Do not share it.</p>
  <p style="font-size:12px;color:#aaa;margin-top:8px;">If the button doesn't work, copy this link: ${link}</p>
  ${accountHtmlBlock}
</body>
</html>`

  const form = new FormData()
  form.append('from', FROM_EMAIL)
  form.append('to', to)
  form.append('subject', `Your form link — ${formName}`)
  form.append('text', text)
  form.append('html', html)

  const res = await fetch(`https://api.mailgun.net/v3/${MAILGUN_DOMAIN}/messages`, {
    method: 'POST',
    headers: { Authorization: `Basic ${Buffer.from(`api:${MAILGUN_API_KEY}`).toString('base64')}` },
    body: form,
  })

  if (!res.ok) {
    const detail = await res.text()
    throw new Error(`Mailgun error ${res.status}: ${detail}`)
  }
}

async function sendEmail(to: string, subject: string, text: string, html: string): Promise<void> {
  if (!MAILGUN_API_KEY || !MAILGUN_DOMAIN) {
    console.log(`\n[EMAIL - no Mailgun key]\nTo: ${to}\nSubject: ${subject}\n${text}\n`)
    return
  }
  const form = new FormData()
  form.append('from', FROM_EMAIL)
  form.append('to', to)
  form.append('subject', subject)
  form.append('text', text)
  form.append('html', html)
  const res = await fetch(`https://api.mailgun.net/v3/${MAILGUN_DOMAIN}/messages`, {
    method: 'POST',
    headers: { Authorization: `Basic ${Buffer.from(`api:${MAILGUN_API_KEY}`).toString('base64')}` },
    body: form,
  })
  if (!res.ok) throw new Error(`Mailgun error ${res.status}: ${await res.text()}`)
}

export async function sendCollaborationEmail(params: {
  to: string
  ownerEmail: string
  formName: string
  programName: string
  token: string
  formSlug: string
  expiresAt: string
  comment?: string
  flaggedFieldCount: number
}): Promise<void> {
  const { to, ownerEmail, formName, programName, token, formSlug, expiresAt, comment, flaggedFieldCount } = params
  const link = `${APP_URL}/f/${formSlug}?token=${token}`
  const expiry = new Date(expiresAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
  const subject = `${ownerEmail} needs your help with "${formName}"`
  const flagNote = flaggedFieldCount > 0
    ? `${flaggedFieldCount} question${flaggedFieldCount !== 1 ? 's are' : ' is'} specifically flagged for your response.`
    : 'Please add your responses where needed.'
  const commentBlock = comment ? `\nMessage from ${ownerEmail}:\n"${comment}"\n` : ''
  const text = [
    `${ownerEmail} has asked for your help completing a form for ${programName}.`,
    commentBlock,
    flagNote,
    '',
    `Form: ${formName}`,
    `Link: ${link}`,
    '',
    `This link expires on ${expiry}. Once you submit, your responses will be returned to ${ownerEmail} for final review.`,
  ].join('\n')
  const html = `
<!DOCTYPE html><html><body style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:32px 16px;color:#111;">
  <h2 style="font-size:20px;margin-bottom:8px;">${ownerEmail} needs your help</h2>
  <p style="color:#555;">They've asked you to help complete <strong>${formName}</strong> for <strong>${programName}</strong>.</p>
  ${comment ? `<div style="background:#f9f9f9;border-left:3px solid #ea580c;padding:10px 14px;margin:16px 0;font-size:14px;color:#333;"><em>"${comment}"</em></div>` : ''}
  <p style="font-size:14px;color:#555;">${flagNote}</p>
  <a href="${link}" style="display:inline-block;background:#ea580c;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;margin:8px 0;">Open form</a>
  <p style="margin-top:20px;font-size:13px;color:#888;">Expires ${expiry}. When you submit, your responses go back to ${ownerEmail} for final review — they will make the official submission.</p>
  <p style="font-size:12px;color:#aaa;">Link: ${link}</p>
</body></html>`
  await sendEmail(to, subject, text, html)
}

export async function sendReturnToEditEmail(params: {
  to: string
  reviewerName: string
  formName: string
  programName: string
  comment: string
  formLink?: string
}): Promise<void> {
  const { to, reviewerName, formName, programName, comment, formLink } = params
  const subject = `Your submission for "${formName}" has been returned for editing`
  const text = [
    `${reviewerName} has returned your submission for "${formName}" (${programName}) with the following note:`,
    '',
    `"${comment}"`,
    '',
    formLink
      ? `Please open the form below, make your changes, and resubmit:\n${formLink}`
      : `Please reach out to your program coordinator to resubmit.`,
  ].join('\n')
  const html = `
<!DOCTYPE html><html><body style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:32px 16px;color:#111;">
  <h2 style="font-size:20px;margin-bottom:8px;">Your submission needs attention</h2>
  <p style="color:#555;"><strong>${reviewerName}</strong> has returned your submission for <strong>${formName}</strong> (${programName}) with the following note:</p>
  <div style="background:#fffbeb;border-left:3px solid #f59e0b;padding:12px 16px;margin:20px 0;font-size:14px;color:#333;border-radius:4px;">
    <em>"${comment}"</em>
  </div>
  <p style="color:#555;font-size:14px;">Please review the feedback, make your changes, and resubmit.</p>
  ${formLink ? `<a href="${formLink}" style="display:inline-block;background:#ea580c;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;margin:8px 0;">Open form to edit</a><p style="font-size:12px;color:#aaa;margin-top:12px;">If the button doesn't work, copy this link: ${formLink}</p>` : ''}
</body></html>`
  await sendEmail(to, subject, text, html)
}

export async function sendReviewerFeedbackEmail(params: {
  to: string
  reviewerName: string
  formName: string
  programName: string
  comment: string
}): Promise<void> {
  const { to, reviewerName, formName, programName, comment } = params
  const subject = `Your submission for "${formName}" needs attention`
  const text = [
    `A reviewer at ${programName} has flagged your submission for "${formName}" and left the following feedback:`,
    '',
    `"${comment}"`,
    '',
    `Please reach out to your program coordinator if you have questions or need to resubmit.`,
  ].join('\n')
  const html = `
<!DOCTYPE html><html><body style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:32px 16px;color:#111;">
  <h2 style="font-size:20px;margin-bottom:8px;">Your submission needs attention</h2>
  <p style="color:#555;">Your submission for <strong>${formName}</strong> (${programName}) has been reviewed and flagged with the following note from <strong>${reviewerName}</strong>:</p>
  <div style="background:#fffbeb;border-left:3px solid #f59e0b;padding:12px 16px;margin:20px 0;font-size:14px;color:#333;border-radius:4px;">
    <em>"${comment}"</em>
  </div>
  <p style="font-size:13px;color:#888;">Please reach out to your program coordinator if you have questions or need to make changes.</p>
</body></html>`
  await sendEmail(to, subject, text, html)
}

export async function sendInviteEmail(params: {
  to: string
  inviteUrl: string
  programName: string
}): Promise<void> {
  const { to, inviteUrl, programName } = params
  const subject = `You've been invited to ${programName}`
  const text = [
    `You've been invited to join ${programName} on Extension Pulse.`,
    '',
    `Click the link below to accept your invitation and set up your account:`,
    inviteUrl,
    '',
    `This link expires in 24 hours.`,
  ].join('\n')
  const html = `
<!DOCTYPE html><html><body style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:32px 16px;color:#111;">
  <h2 style="font-size:20px;margin-bottom:8px;">You've been invited to ${programName}</h2>
  <p style="color:#555;margin-bottom:24px;">Click below to accept your invitation and set up your account on Extension Pulse.</p>
  <a href="${inviteUrl}" style="display:inline-block;background:#ea580c;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">Accept invitation</a>
  <p style="margin-top:24px;font-size:13px;color:#888;">This link expires in 24 hours.</p>
  <p style="font-size:12px;color:#aaa;margin-top:8px;">If the button doesn't work, copy this link: ${inviteUrl}</p>
</body></html>`
  await sendEmail(to, subject, text, html)
}

export async function sendWelcomeWithPasswordEmail(params: {
  to: string
  temporaryPassword: string
  loginUrl: string
  programName: string
}): Promise<void> {
  const { to, temporaryPassword, loginUrl, programName } = params
  const subject = `Your Extension Pulse account for ${programName}`
  const text = [
    `An account has been created for you on Extension Pulse for ${programName}.`,
    '',
    `Login: ${loginUrl}`,
    `Email: ${to}`,
    `Temporary password: ${temporaryPassword}`,
    '',
    `You can change your password after signing in.`,
  ].join('\n')
  const html = `
<!DOCTYPE html><html><body style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:32px 16px;color:#111;">
  <h2 style="font-size:20px;margin-bottom:8px;">Your Extension Pulse account</h2>
  <p style="color:#555;margin-bottom:20px;">An account has been created for you for <strong>${programName}</strong>. Use the credentials below to sign in.</p>
  <div style="background:#f9f9f9;border:1px solid #e5e7eb;border-radius:8px;padding:16px 20px;margin-bottom:24px;font-size:14px;">
    <p style="margin:0 0 8px;color:#555;"><strong>Email:</strong> ${to}</p>
    <p style="margin:0;color:#555;"><strong>Temporary password:</strong> <code style="background:#efefef;padding:2px 6px;border-radius:4px;">${temporaryPassword}</code></p>
  </div>
  <a href="${loginUrl}" style="display:inline-block;background:#ea580c;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">Sign in</a>
  <p style="margin-top:24px;font-size:13px;color:#888;">We recommend changing your password after your first sign-in.</p>
</body></html>`
  await sendEmail(to, subject, text, html)
}

export async function sendPasswordResetEmail(params: {
  to: string
  resetUrl: string
  programName: string
}): Promise<void> {
  const { to, resetUrl, programName } = params
  const subject = 'Reset your Extension Pulse password'
  const text = [
    `A password reset was requested for your Extension Pulse account (${programName}).`,
    '',
    `Click the link below to set a new password:`,
    resetUrl,
    '',
    `If you didn't request this, you can ignore this email.`,
  ].join('\n')
  const html = `
<!DOCTYPE html><html><body style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:32px 16px;color:#111;">
  <h2 style="font-size:20px;margin-bottom:8px;">Reset your password</h2>
  <p style="color:#555;margin-bottom:24px;">A password reset was requested for your Extension Pulse account on <strong>${programName}</strong>.</p>
  <a href="${resetUrl}" style="display:inline-block;background:#ea580c;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">Set new password</a>
  <p style="margin-top:24px;font-size:13px;color:#888;">If you didn't request this reset, you can safely ignore this email.</p>
  <p style="font-size:12px;color:#aaa;margin-top:8px;">If the button doesn't work, copy this link: ${resetUrl}</p>
</body></html>`
  await sendEmail(to, subject, text, html)
}

export async function sendReturnNotificationEmail(params: {
  to: string
  collaboratorEmail: string
  formName: string
  formSlug: string
  token: string
}): Promise<void> {
  const { to, collaboratorEmail, formName, formSlug, token } = params
  const link = `${APP_URL}/f/${formSlug}?token=${token}`
  const subject = `Your delegated form has been returned — "${formName}"`
  const text = [
    `${collaboratorEmail} has completed their portion of "${formName}" and returned it to you for review.`,
    '',
    `Open the form to review their responses, make any final edits, and submit:`,
    link,
  ].join('\n')
  const html = `
<!DOCTYPE html><html><body style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:32px 16px;color:#111;">
  <h2 style="font-size:20px;margin-bottom:8px;">Your form is ready to review</h2>
  <p style="color:#555;"><strong>${collaboratorEmail}</strong> has filled in their responses to <strong>${formName}</strong> and returned it to you.</p>
  <p style="color:#555;">Review their answers, make any final edits, and submit when ready.</p>
  <a href="${link}" style="display:inline-block;background:#ea580c;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;margin:8px 0;">Review &amp; submit</a>
  <p style="font-size:12px;color:#aaa;margin-top:16px;">Link: ${link}</p>
</body></html>`
  await sendEmail(to, subject, text, html)
}
