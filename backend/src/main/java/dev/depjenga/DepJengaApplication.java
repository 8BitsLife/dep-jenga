package dev.depjenga;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.context.annotation.Bean;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

@SpringBootApplication
public class DepJengaApplication {

    public static void main(String[] args) {
        SpringApplication.run(DepJengaApplication.class, args);
    }

    @Bean
    WebMvcConfigurer cors(@Value("${depjenga.allowed-origins}") String[] origins) {
        return new WebMvcConfigurer() {
            @Override
            public void addCorsMappings(CorsRegistry registry) {
                // patterns, so a single entry like https://*.vercel.app also covers preview deployments
                registry.addMapping("/api/**").allowedOriginPatterns(origins).allowedMethods("GET", "POST");
            }
        };
    }
}
