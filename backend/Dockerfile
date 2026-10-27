# ---- build: compile the Spring Boot jar ----
FROM maven:3.9.9-eclipse-temurin-21 AS build
WORKDIR /src
# dependencies first, so code changes don't re-download the world
COPY pom.xml .
RUN mvn -q -B dependency:go-offline
COPY src ./src
RUN mvn -q -B package -DskipTests && cp target/depjenga-backend-*.jar /src/app.jar

# ---- run: a slim JRE ----
FROM eclipse-temurin:21-jre
WORKDIR /app
RUN useradd --system --uid 10001 depjenga
COPY --from=build /src/app.jar app.jar
USER depjenga
# Render and most hosts inject PORT; the app reads it (defaults to 8080).
ENV PORT=8080
EXPOSE 8080
# size the heap from the container's memory limit so small instances (512 MB) don't get OOM-killed
ENV JAVA_TOOL_OPTIONS="-XX:MaxRAMPercentage=75 -XX:+UseSerialGC -Xss512k"
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
