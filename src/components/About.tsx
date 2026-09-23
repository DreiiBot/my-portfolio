import portrait from '../assets/eleandre-red.jpg'
import { achievements, bio, profile, specialties } from '../data/profile'

export function About() {
  const [first, second, third] = bio

  return (
    <section id="about" className="about">
      <div className="wrap">
        <div className="about__grid">
          <figure className="about__portrait">
            <img src={portrait} alt="Eleandre Sales in a red-lit studio portrait" width="1024" height="1024" loading="lazy" />
          </figure>

          <div className="about__hello">
            <h2 className="about__title">Hi, I’m {profile.firstName}.</h2>
            <p className="prose">{first}</p>
          </div>

          <p className="about__pull">{second}</p>

          <div className="about__side">
            <p className="prose prose--small">{third}</p>
            <div className="about__special">
              <h3 className="cell-title">What I specialise in</h3>
              <ul className="do-list">
                {specialties.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        <div className="proud">
          <h2 className="proud__title">What I’m proudest of</h2>
          <div className="proud__grid">
            {achievements.map((a) => (
              <article key={a.title} className="proud__item">
                <h3 className="proud__item-title">{a.title}</h3>
                <p className="proud__item-body">{a.body}</p>
              </article>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
